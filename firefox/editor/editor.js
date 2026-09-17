// CaptureX Editor — Full Annotation Engine
// Tools: select, crop, pen, highlighter, rect, ellipse, arrow, text, counter, blur-rect, blur-brush, eraser, image-insert
// Features: Interactive Object-based Selection & Resize for arrows, text, shapes & imported pictures, Catmull-Rom smooth pen, undo/redo, export PNG/PDF

'use strict';

// ─── Global State ──────────────────────────────────────────────────────────
const state = {
  tool: 'select',
  arrowType: 'arrow-solid',
  blurType: 'blur-rect',
  blurLevel: 10,
  blurBrushSize: 40,
  strokeColor: '#FFD600',
  strokeOpacity: 1,
  fillColor: '#4f8ef7',
  fillOpacity: 0,
  strokeWidth: 3,
  font: 'Arial, sans-serif',
  fontSize: 24,
  zoom: 1,
  dpr: 1,
  isDrawing: false,
  startX: 0, startY: 0,
  lastX: 0, lastY: 0,
  penPoints: [],
  counterVal: 1,
  undoStack: [],
  redoStack: [],
  cropState: null,
  textInputActive: false,
  _textX: 0,
  _textY: 0,
  _editingTextObj: null,
  // Object system for select, move, and resize
  objects: [],
  selectedObject: null,
  dragMode: null, // 'move' | 'handle'
  activeHandle: null,
  dragStart: { x: 0, y: 0 },
  dragInitialObj: null,
  dragInitialBounds: null
};

// ─── Canvas Setup ──────────────────────────────────────────────────────────
const baseCanvas = document.getElementById('base-canvas');
const baseCtx = baseCanvas.getContext('2d');
const annCanvas = document.getElementById('annotation-canvas');
const annCtx = annCanvas.getContext('2d');
const wrapper = document.getElementById('canvas-wrapper');
const canvasArea = document.getElementById('canvas-area');

// Internal raster layer for freehand pen, highlighter, eraser
const drawingCanvas = document.createElement('canvas');
const drawingCtx = drawingCanvas.getContext('2d');

let canvasW = 800, canvasH = 600;

function setCanvasSize(w, h) {
  canvasW = w; canvasH = h;
  baseCanvas.width = w; baseCanvas.height = h;
  annCanvas.width = w; annCanvas.height = h;
  drawingCanvas.width = w; drawingCanvas.height = h;
  updateDisplaySize();
  renderAll();
}

function updateDisplaySize() {
  const cssW = Math.round(canvasW * state.zoom);
  const cssH = Math.round(canvasH * state.zoom);
  wrapper.style.width = cssW + 'px';
  wrapper.style.height = cssH + 'px';
  baseCanvas.style.width = cssW + 'px';
  baseCanvas.style.height = cssH + 'px';
  annCanvas.style.width = cssW + 'px';
  annCanvas.style.height = cssH + 'px';
  document.getElementById('zoom-label').textContent = Math.round(state.zoom * 100) + '%';
  if (state.cropState) updateCropBox();
}

// ─── Canvas Coordinates ──────────────────────────────────────────────────
annCanvas.addEventListener('mousemove', (e) => {
  const p = getCanvasPoint(e);
  document.getElementById('canvas-coords').textContent = `${Math.round(p.x)}, ${Math.round(p.y)}`;
});

function getCanvasPoint(e) {
  const rect = annCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / (rect.width / canvasW),
    y: (e.clientY - rect.top) / (rect.height / canvasH)
  };
}

// ─── Load Image from Storage ──────────────────────────────────────────────
async function loadCapture() {
  const params = new URLSearchParams(location.search);
  const key = params.get('key');
  if (!key) {
    setCanvasSize(1280, 720);
    baseCtx.fillStyle = '#ffffff';
    baseCtx.fillRect(0, 0, canvasW, canvasH);
    fitZoom();
    hideLoading();
    return;
  }

  const api = typeof browser !== 'undefined' ? browser : chrome;
  const stored = await api.storage.local.get(key);
  const data = stored[key];
  if (!data) { hideLoading(); return; }

  if (data.mode === 'fullpage' && data.tiles) {
    await stitchFullPage(data);
  } else if (data.crop) {
    await loadDataUrlWithCrop(data.dataUrl, data.crop);
  } else {
    await loadDataUrl(data.dataUrl);
  }

  await api.storage.local.remove(key);
  hideLoading();
}

async function loadDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      setCanvasSize(img.naturalWidth, img.naturalHeight);
      baseCtx.drawImage(img, 0, 0);
      fitZoom();
      resolve();
    };
    img.src = dataUrl;
  });
}

async function loadDataUrlWithCrop(dataUrl, crop) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const dpr = crop.dpr || (img.naturalWidth / (window.innerWidth || 1)) || 1;
      const sx = Math.max(0, Math.round(crop.x * dpr));
      const sy = Math.max(0, Math.round(crop.y * dpr));
      const sw = Math.max(1, Math.min(Math.round(crop.w * dpr), img.naturalWidth - sx));
      const sh = Math.max(1, Math.min(Math.round(crop.h * dpr), img.naturalHeight - sy));

      setCanvasSize(sw, sh);
      baseCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      fitZoom();
      resolve();
    };
    img.src = dataUrl;
  });
}

async function stitchFullPage(data) {
  const { tiles, totalW, totalH, viewW, viewH, dpr = 1 } = data;
  if (!tiles || !tiles.length) return;

  const firstTileImg = await new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = tiles[0].dataUrl;
  });

  const scale = firstTileImg.naturalWidth > 0 ? (firstTileImg.naturalWidth / viewW) : dpr;
  state.dpr = scale;

  const totalPixelW = Math.round(totalW * scale);
  const totalPixelH = Math.round(totalH * scale);

  setCanvasSize(totalPixelW, totalPixelH);
  baseCtx.fillStyle = '#ffffff';
  baseCtx.fillRect(0, 0, totalPixelW, totalPixelH);

  for (const tile of tiles) {
    await new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const destX = Math.round(tile.scrollX * scale);
        const destY = Math.round(tile.scrollY * scale);
        const drawW = Math.min(viewW, totalW - tile.scrollX);
        const drawH = Math.min(viewH, totalH - tile.scrollY);
        const srcW = Math.round(drawW * scale);
        const srcH = Math.round(drawH * scale);

        baseCtx.drawImage(img, 0, 0, srcW, srcH, destX, destY, srcW, srcH);
        resolve();
      };
      img.src = tile.dataUrl;
    });
  }

  // Full-page optional text watermark
  const api = typeof browser !== 'undefined' ? browser : chrome;
  try {
    const prefs = await api.storage.local.get(['prefWatermarkEnabled', 'prefWatermarkText', 'prefWatermarkPos']);
    if (prefs.prefWatermarkEnabled === 'true' || prefs.prefWatermarkEnabled === true) {
      const wmText = prefs.prefWatermarkText || 'CaptureX Screenshot';
      const wmPos = prefs.prefWatermarkPos || 'bottom-right';
      renderWatermarkOnCanvas(baseCtx, totalPixelW, totalPixelH, wmText, wmPos);
    }
  } catch (err) {
    console.warn('Could not apply full-page watermark:', err);
  }

  fitZoom();
}

function renderWatermarkOnCanvas(ctx, w, h, text, pos) {
  ctx.save();
  const fontSize = Math.max(13, Math.min(28, Math.round(w * 0.014)));
  ctx.font = `600 ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = 'middle';

  const metrics = ctx.measureText(text);
  const padX = Math.round(fontSize * 0.85);
  const padY = Math.round(fontSize * 0.5);
  const pillW = metrics.width + padX * 2 + fontSize * 1.1;
  const pillH = fontSize + padY * 2;
  const margin = Math.round(fontSize * 1.5);

  const pillX = (pos === 'bottom-left') ? margin : (w - pillW - margin);
  const pillY = h - pillH - margin;

  // Background pill
  ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1;

  const r = pillH / 2;
  ctx.beginPath();
  ctx.moveTo(pillX + r, pillY);
  ctx.lineTo(pillX + pillW - r, pillY);
  ctx.arc(pillX + pillW - r, pillY + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(pillX + r, pillY + pillH);
  ctx.arc(pillX + r, pillY + r, r, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Blue dot accent
  const dotX = pillX + padX + (fontSize * 0.35);
  const dotY = pillY + pillH / 2;
  ctx.beginPath();
  ctx.arc(dotX, dotY, fontSize * 0.26, 0, Math.PI * 2);
  ctx.fillStyle = '#4f8ef7';
  ctx.fill();

  // Text
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fillText(text, pillX + padX + fontSize * 0.9, pillY + pillH / 2);
  ctx.restore();
}

function fitZoom() {
  const areaW = (canvasArea && canvasArea.clientWidth) ? canvasArea.clientWidth : window.innerWidth;
  const areaH = (canvasArea && canvasArea.clientHeight) ? canvasArea.clientHeight : (window.innerHeight - 56);
  const padding = 48;
  const avW = Math.max(100, areaW - padding);
  const avH = Math.max(100, areaH - padding);

  const zW = avW / canvasW;
  const zH = avH / canvasH;

  let bestZoom = Math.min(zW, zH);
  if (canvasH > canvasW * 2) {
    bestZoom = zW;
  }

  state.zoom = Math.max(0.1, Math.min(3.0, parseFloat(bestZoom.toFixed(2))));
  updateDisplaySize();
}

function hideLoading() {
  const ls = document.getElementById('loading-screen');
  if (ls) {
    ls.classList.add('hide');
    setTimeout(() => ls.remove(), 600);
  }
}

// ─── Zoom Controls ────────────────────────────────────────────────────────
function applyZoom() {
  updateDisplaySize();
}

document.getElementById('zoom-in').onclick = () => {
  state.zoom = Math.min(4, parseFloat((state.zoom + 0.1).toFixed(2)));
  applyZoom();
};
document.getElementById('zoom-out').onclick = () => {
  state.zoom = Math.max(0.1, parseFloat((state.zoom - 0.1).toFixed(2)));
  applyZoom();
};
document.getElementById('zoom-fit').onclick = fitZoom;
document.getElementById('zoom-label').onclick = () => {
  state.zoom = 1; applyZoom();
};

canvasArea.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  state.zoom = Math.max(0.1, Math.min(4, parseFloat((state.zoom + delta).toFixed(2))));
  applyZoom();
}, { passive: false });

// ─── Undo / Redo ──────────────────────────────────────────────────────────
function cloneObject(o) {
  if (!o) return null;
  if (o.type === 'doodle' && o.points) {
    return { ...o, points: o.points.map(pt => ({ ...pt })) };
  }
  return { ...o };
}

function saveUndo() {
  const snap = {
    base: baseCtx.getImageData(0, 0, canvasW, canvasH),
    drawing: drawingCtx.getImageData(0, 0, canvasW, canvasH),
    objects: state.objects.map(cloneObject)
  };
  state.undoStack.push(snap);
  if (state.undoStack.length > 50) state.undoStack.shift();
  state.redoStack = [];
  updateUndoButtons();
}

function undo() {
  if (!state.undoStack.length) return;
  const curr = {
    base: baseCtx.getImageData(0, 0, canvasW, canvasH),
    drawing: drawingCtx.getImageData(0, 0, canvasW, canvasH),
    objects: state.objects.map(cloneObject)
  };
  state.redoStack.push(curr);
  const snap = state.undoStack.pop();
  baseCtx.putImageData(snap.base, 0, 0);
  drawingCtx.putImageData(snap.drawing, 0, 0);
  state.objects = snap.objects.map(cloneObject);
  state.selectedObject = null;
  renderAll();
  updateUndoButtons();
}

function redo() {
  if (!state.redoStack.length) return;
  const curr = {
    base: baseCtx.getImageData(0, 0, canvasW, canvasH),
    drawing: drawingCtx.getImageData(0, 0, canvasW, canvasH),
    objects: state.objects.map(cloneObject)
  };
  state.undoStack.push(curr);
  const snap = state.redoStack.pop();
  baseCtx.putImageData(snap.base, 0, 0);
  drawingCtx.putImageData(snap.drawing, 0, 0);
  state.objects = snap.objects.map(cloneObject);
  state.selectedObject = null;
  renderAll();
  updateUndoButtons();
}

function updateUndoButtons() {
  document.getElementById('undo-btn').disabled = !state.undoStack.length;
  document.getElementById('redo-btn').disabled = !state.redoStack.length;
}

document.getElementById('undo-btn').onclick = undo;
document.getElementById('redo-btn').onclick = redo;

// ─── Style Controls ──────────────────────────────────────────────────────
function syncToolbarToSelected(obj) {
  if (!obj) return;
  if (obj.strokeColor || obj.color) {
    const col = obj.strokeColor || obj.color;
    state.strokeColor = col;
    const sc = document.getElementById('stroke-color');
    if (sc) sc.value = col;
    const swatch = document.getElementById('stroke-color-swatch');
    if (swatch) swatch.style.background = col;
  }
  if (obj.strokeWidth) {
    state.strokeWidth = obj.strokeWidth;
    const sw = document.getElementById('stroke-width');
    if (sw) sw.value = obj.strokeWidth;
    const sval = document.getElementById('stroke-val');
    if (sval) sval.textContent = obj.strokeWidth + 'px';
  }
  if (obj.fontSize) {
    state.fontSize = obj.fontSize;
    const fs = document.getElementById('font-size-input');
    if (fs) fs.value = obj.fontSize;
  }
  if (obj.fillColor) {
    state.fillColor = obj.fillColor;
    const fc = document.getElementById('fill-color');
    if (fc) fc.value = obj.fillColor;
    const swatch = document.getElementById('fill-color-swatch');
    if (swatch) swatch.style.background = obj.fillColor;
  }
}

document.getElementById('stroke-width').addEventListener('input', (e) => {
  state.strokeWidth = parseInt(e.target.value);
  document.getElementById('stroke-val').textContent = state.strokeWidth + 'px';
  if (state.selectedObject && ['arrow', 'rect', 'ellipse', 'doodle'].includes(state.selectedObject.type)) {
    saveUndo();
    state.selectedObject.strokeWidth = state.strokeWidth;
    renderAll();
  }
});

document.getElementById('stroke-color').addEventListener('input', (e) => {
  state.strokeColor = e.target.value;
  document.getElementById('stroke-color-swatch').style.background = e.target.value;
  if (state.selectedObject) {
    saveUndo();
    if (state.selectedObject.type === 'text') state.selectedObject.color = e.target.value;
    else state.selectedObject.strokeColor = e.target.value;
    renderAll();
  }
});
document.getElementById('stroke-color-swatch').addEventListener('click', () => {
  document.getElementById('stroke-color').click();
});

document.getElementById('stroke-opacity').addEventListener('input', (e) => {
  state.strokeOpacity = parseInt(e.target.value) / 100;
  document.getElementById('stroke-opacity-val').textContent = e.target.value + '%';
  if (state.selectedObject) {
    saveUndo();
    if (state.selectedObject.type === 'text') state.selectedObject.opacity = state.strokeOpacity;
    else state.selectedObject.strokeOpacity = state.strokeOpacity;
    renderAll();
  }
});

document.getElementById('fill-color').addEventListener('input', (e) => {
  state.fillColor = e.target.value;
  const swatch = document.getElementById('fill-color-swatch');
  swatch.style.background = e.target.value;
  const x = swatch.querySelector('.no-fill-x');
  if (x) x.style.display = state.fillOpacity > 0 ? 'none' : 'flex';
  if (state.selectedObject && ['rect', 'ellipse'].includes(state.selectedObject.type)) {
    saveUndo();
    state.selectedObject.fillColor = e.target.value;
    renderAll();
  }
});
document.getElementById('fill-color-swatch').addEventListener('click', () => {
  document.getElementById('fill-color').click();
});

document.getElementById('fill-opacity').addEventListener('input', (e) => {
  state.fillOpacity = parseInt(e.target.value) / 100;
  document.getElementById('fill-opacity-val').textContent = e.target.value + '%';
  const swatch = document.getElementById('fill-color-swatch');
  const x = swatch.querySelector('.no-fill-x');
  if (x) x.style.display = state.fillOpacity > 0 ? 'none' : 'flex';
  if (state.selectedObject && ['rect', 'ellipse'].includes(state.selectedObject.type)) {
    saveUndo();
    state.selectedObject.fillOpacity = state.fillOpacity;
    renderAll();
  }
});

// ─── Tool Selection & Dropdown Handling ──────────────────────────────────
function selectTool(tool) {
  if (state.tool === 'text' && state.textInputActive) {
    commitText();
  }

  state.tool = tool;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-tool="${tool}"]`) || document.getElementById(`tool-${tool}`);
  if (btn) btn.classList.add('active');

  // Set cursor
  switch(tool) {
    case 'select': annCanvas.style.cursor = 'default'; break;
    case 'crop': annCanvas.style.cursor = 'crosshair'; break;
    case 'pen': case 'highlighter': annCanvas.style.cursor = 'crosshair'; break;
    case 'eraser': annCanvas.style.cursor = 'cell'; break;
    case 'blur-rect': case 'blur-brush': annCanvas.style.cursor = 'crosshair'; break;
    case 'text': annCanvas.style.cursor = 'text'; break;
    default: annCanvas.style.cursor = 'crosshair';
  }

  if (tool === 'crop') {
    initCrop();
  } else {
    document.getElementById('crop-overlay').style.display = 'none';
  }

  if (tool !== 'select') {
    state.selectedObject = null;
  }
  renderAll();
}

function getDropdownId(tool) {
  const map = {
    'arrow': 'arrow-dropdown',
    'text': 'font-dropdown',
    'blur': 'blur-dropdown',
    'blur-rect': 'blur-dropdown',
    'blur-brush': 'blur-dropdown'
  };
  return map[tool] || null;
}

function closeAllDropdowns() {
  document.querySelectorAll('.tool-dropdown, .export-dropdown').forEach(d => d.classList.remove('open'));
}

document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const tool = btn.dataset.tool;
    const isDropdownTrigger = btn.classList.contains('tool-dropdown-trigger');

    if (isDropdownTrigger) {
      const dropId = getDropdownId(tool);
      if (dropId) {
        const dd = document.getElementById(dropId);
        if (dd) {
          const wasOpen = dd.classList.contains('open');
          closeAllDropdowns();
          if (!wasOpen) dd.classList.add('open');
        }
      }
    } else {
      closeAllDropdowns();
    }

    selectTool(tool);
  });
});

// Arrow dropdown item selection
document.querySelectorAll('#arrow-dropdown .dropdown-item').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const arrow = btn.dataset.arrow;
    if (!arrow) return;
    state.arrowType = arrow;
    document.querySelectorAll('#arrow-dropdown .dropdown-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectTool('arrow');
    closeAllDropdowns();
  });
});

// Font dropdown item selection
document.querySelectorAll('#font-dropdown .font-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('#font-dropdown .font-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    state.font = item.dataset.font;
    selectTool('text');
    closeAllDropdowns();
  });
});

document.getElementById('font-size-input').addEventListener('input', (e) => {
  state.fontSize = parseInt(e.target.value) || 24;
  if (state.selectedObject && state.selectedObject.type === 'text') {
    saveUndo();
    state.selectedObject.fontSize = state.fontSize;
    renderAll();
  }
});

// Blur dropdown item selection
document.querySelectorAll('#blur-dropdown [data-blur]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const blurMode = btn.dataset.blur;
    state.blurType = blurMode;
    document.querySelectorAll('#blur-dropdown [data-blur]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectTool(blurMode);
    closeAllDropdowns();
  });
});

document.getElementById('blur-level').addEventListener('input', (e) => {
  state.blurLevel = parseInt(e.target.value);
  document.getElementById('blur-level-val').textContent = state.blurLevel;
});

document.getElementById('blur-brush').addEventListener('input', (e) => {
  state.blurBrushSize = parseInt(e.target.value);
  document.getElementById('blur-brush-val').textContent = state.blurBrushSize;
});

// Export dropdown trigger
document.getElementById('export-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const dd = document.getElementById('export-dropdown');
  const wasOpen = dd.classList.contains('open');
  closeAllDropdowns();
  if (!wasOpen) dd.classList.add('open');
});

document.getElementById('export-png').addEventListener('click', exportPNG);
document.getElementById('export-pdf-single').addEventListener('click', exportPDFSingle);
document.getElementById('export-pdf-multi').addEventListener('click', exportPDFMulti);

// Close dropdowns on click outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.toolbar') && !e.target.closest('.tool-dropdown') && !e.target.closest('.export-dropdown')) {
    closeAllDropdowns();
  }
});

// ─── Text Tool ────────────────────────────────────────────────────────────
function placeTextInput(x, y, existingObj = null) {
  if (state.textInputActive) {
    commitText();
  }

  const box = document.getElementById('text-input-box');
  const textarea = document.getElementById('text-input-area');

  state._textX = x;
  state._textY = y;
  state._editingTextObj = existingObj;
  state.textInputActive = true;

  const posX = Math.round(x * state.zoom);
  const posY = Math.round(y * state.zoom);
  box.style.left = posX + 'px';
  box.style.top = posY + 'px';
  box.style.display = 'flex';

  textarea.style.fontFamily = existingObj ? (existingObj.font || state.font) : state.font;
  textarea.style.fontSize = Math.max(14, Math.round((existingObj ? (existingObj.fontSize || state.fontSize) : state.fontSize) * state.zoom)) + 'px';
  textarea.style.color = existingObj ? (existingObj.color || state.strokeColor) : state.strokeColor;
  textarea.value = existingObj ? (existingObj.text || '') : '';

  setTimeout(() => {
    textarea.focus();
    if (existingObj) textarea.select();
  }, 10);
}

function commitText() {
  if (!state.textInputActive) return;
  const textarea = document.getElementById('text-input-area');
  const txt = textarea.value.trim();

  const wasEditing = state._editingTextObj;
  // Mark text input inactive first so selectTool does not re-enter commitText
  cancelText();

  if (txt) {
    saveUndo();
    if (wasEditing) {
      wasEditing.text = txt;
      wasEditing.font = state.font;
      wasEditing.fontSize = state.fontSize;
      wasEditing.color = state.strokeColor;
      wasEditing.opacity = state.strokeOpacity;
      state.selectedObject = wasEditing;
    } else {
      const obj = {
        id: 'txt_' + Date.now() + '_' + Math.random(),
        type: 'text',
        x: state._textX,
        y: state._textY,
        text: txt,
        font: state.font,
        fontSize: state.fontSize,
        color: state.strokeColor,
        opacity: state.strokeOpacity
      };
      state.objects.push(obj);
      state.selectedObject = obj;
    }
    selectTool('select');
  }

  renderAll();
}

function cancelText() {
  const box = document.getElementById('text-input-box');
  const textarea = document.getElementById('text-input-area');
  if (box) box.style.display = 'none';
  if (textarea) textarea.value = '';
  state.textInputActive = false;
  state._editingTextObj = null;
}

document.getElementById('text-commit-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  commitText();
});

document.getElementById('text-cancel-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  cancelText();
  selectTool('select');
  renderAll();
});

document.getElementById('text-input-area').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    cancelText();
    selectTool('select');
    renderAll();
    return;
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
    e.preventDefault();
    commitText();
  }
});

annCanvas.addEventListener('dblclick', (e) => {
  const p = getCanvasPoint(e);
  const hit = hitTestObject(p);
  if (hit && hit.type === 'text') {
    selectTool('text');
    placeTextInput(hit.x, hit.y, hit);
  }
});

// ─── Crop Tool ────────────────────────────────────────────────────────────
function initCrop() {
  const overlay = document.getElementById('crop-overlay');
  overlay.style.display = 'block';

  state.cropState = {
    x: Math.round(canvasW * 0.1),
    y: Math.round(canvasH * 0.1),
    w: Math.round(canvasW * 0.8),
    h: Math.round(canvasH * 0.8)
  };
  updateCropBox();
}

function updateCropBox() {
  const cropBox = document.getElementById('crop-box');
  if (!cropBox || !state.cropState) return;
  const cs = state.cropState;
  cropBox.style.left = (cs.x * state.zoom) + 'px';
  cropBox.style.top = (cs.y * state.zoom) + 'px';
  cropBox.style.width = (cs.w * state.zoom) + 'px';
  cropBox.style.height = (cs.h * state.zoom) + 'px';
}

function applyCrop() {
  const cs = state.cropState;
  if (!cs || cs.w < 10 || cs.h < 10) {
    cancelCrop();
    return;
  }

  saveUndo();

  const cx = Math.max(0, Math.round(cs.x));
  const cy = Math.max(0, Math.round(cs.y));
  const cw = Math.min(canvasW - cx, Math.round(cs.w));
  const ch = Math.min(canvasH - cy, Math.round(cs.h));

  const flat = flattenCanvas();
  const img = new Image();
  img.onload = () => {
    setCanvasSize(cw, ch);
    baseCtx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
    drawingCtx.clearRect(0, 0, cw, ch);
    state.objects = [];
    state.selectedObject = null;
    renderAll();
    fitZoom();
  };
  img.src = flat;

  document.getElementById('crop-overlay').style.display = 'none';
  state.cropState = null;
  selectTool('select');
  showToast('Cropped canvas ✓', 'success');
}

function cancelCrop() {
  document.getElementById('crop-overlay').style.display = 'none';
  state.cropState = null;
  selectTool('select');
}

let isCropDragging = false;
let cropActionType = null;
let cropStartMouse = { x: 0, y: 0 };
let cropInitialBox = null;

const cropOverlayEl = document.getElementById('crop-overlay');
cropOverlayEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (e.target.closest('.crop-actions')) return;

  e.preventDefault();
  e.stopPropagation();

  const handle = e.target.dataset.handle;
  cropStartMouse = { x: e.clientX, y: e.clientY };

  if (handle) {
    cropActionType = 'handle-' + handle;
    cropInitialBox = { ...state.cropState };
  } else if (e.target.id === 'crop-box' || e.target.closest('#crop-box')) {
    cropActionType = 'move';
    cropInitialBox = { ...state.cropState };
  } else {
    cropActionType = 'create';
    const p = getCanvasPoint(e);
    state.cropState = { x: p.x, y: p.y, w: 0, h: 0 };
    cropInitialBox = { ...state.cropState };
    updateCropBox();
  }
  isCropDragging = true;
});

document.addEventListener('mousemove', (e) => {
  if (!isCropDragging || !state.cropState) return;

  const dx = (e.clientX - cropStartMouse.x) / state.zoom;
  const dy = (e.clientY - cropStartMouse.y) / state.zoom;
  const cs = state.cropState;
  const s = cropInitialBox;

  if (cropActionType === 'move') {
    cs.x = Math.max(0, Math.min(canvasW - s.w, s.x + dx));
    cs.y = Math.max(0, Math.min(canvasH - s.h, s.y + dy));
  } else if (cropActionType === 'create') {
    const p = getCanvasPoint(e);
    cs.x = Math.max(0, Math.min(s.x, p.x));
    cs.y = Math.max(0, Math.min(s.y, p.y));
    cs.w = Math.min(canvasW - cs.x, Math.abs(p.x - s.x));
    cs.h = Math.min(canvasH - cs.y, Math.abs(p.y - s.y));
  } else if (cropActionType && cropActionType.startsWith('handle-')) {
    const h = cropActionType.replace('handle-', '');
    if (h.includes('r') || h === 'mr') cs.w = Math.max(20, Math.min(canvasW - s.x, s.w + dx));
    if (h.includes('b') || h === 'bc') cs.h = Math.max(20, Math.min(canvasH - s.y, s.h + dy));
    if (h.includes('l') || h === 'ml') {
      const newW = s.w - dx;
      if (newW >= 20) { cs.x = Math.max(0, s.x + dx); cs.w = newW; }
    }
    if (h.includes('t') || h === 'tc') {
      const newH = s.h - dy;
      if (newH >= 20) { cs.y = Math.max(0, s.y + dy); cs.h = newH; }
    }
  }

  updateCropBox();
});

document.addEventListener('mouseup', () => {
  if (isCropDragging) {
    isCropDragging = false;
    cropActionType = null;
    if (state.cropState && (state.cropState.w < 10 || state.cropState.h < 10)) {
      initCrop();
    }
  }
});

document.getElementById('crop-apply').addEventListener('click', (e) => {
  e.stopPropagation();
  applyCrop();
});

document.getElementById('crop-cancel').addEventListener('click', (e) => {
  e.stopPropagation();
  cancelCrop();
});

// ─── Image Insert ─────────────────────────────────────────────────────────
document.getElementById('tool-image').addEventListener('click', () => {
  document.getElementById('image-file-input').click();
});

document.getElementById('image-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    insertImage(img);
    URL.revokeObjectURL(url);
  };
  img.src = url;
  e.target.value = '';
});

function insertImage(img) {
  saveUndo();
  const scale = Math.min(1, (canvasW / img.naturalWidth) * 0.7, (canvasH / img.naturalHeight) * 0.7);
  const iw = Math.max(40, Math.round(img.naturalWidth * scale));
  const ih = Math.max(40, Math.round(img.naturalHeight * scale));
  const ix = Math.round((canvasW - iw) / 2);
  const iy = Math.round((canvasH - ih) / 2);

  const obj = {
    id: 'img_' + Date.now() + '_' + Math.random(),
    type: 'image',
    img,
    x: ix,
    y: iy,
    w: iw,
    h: ih
  };

  state.objects.push(obj);
  state.selectedObject = obj;
  selectTool('select');
  renderAll();
  showToast('Image inserted! Drag to move or drag corners to resize', 'info');
}

// ─── Object System: Drawing, Bounds, Handles & Hit Testing ────────────────
function renderAll() {
  annCtx.clearRect(0, 0, canvasW, canvasH);
  // 1. Draw raster drawing layer (freehand pen, highlighter, eraser)
  annCtx.drawImage(drawingCanvas, 0, 0);

  // 2. Draw all interactive objects
  for (const obj of state.objects) {
    drawObject(annCtx, obj);
  }

  // 3. Draw selection box and handles if in select tool
  if (state.tool === 'select' && state.selectedObject) {
    drawSelectionBox(annCtx, state.selectedObject);
  }
}

function drawObject(ctx, obj) {
  if (obj.type === 'arrow') drawArrowObj(ctx, obj);
  else if (obj.type === 'text') drawTextObj(ctx, obj);
  else if (obj.type === 'image') drawImageObj(ctx, obj);
  else if (obj.type === 'rect') drawRectObj(ctx, obj);
  else if (obj.type === 'ellipse') drawEllipseObj(ctx, obj);
  else if (obj.type === 'counter') drawCounterObj(ctx, obj);
  else if (obj.type === 'doodle') drawDoodleObj(ctx, obj);
}

function drawDoodleObj(ctx, obj) {
  if (!obj.points || obj.points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = obj.strokeOpacity ?? (obj.tool === 'highlighter' ? 0.35 : 1);
  ctx.strokeStyle = obj.strokeColor || '#FFD600';
  ctx.lineWidth = obj.tool === 'highlighter' ? (obj.strokeWidth || 3) * 3.5 : (obj.strokeWidth || 3);
  ctx.lineCap = obj.tool === 'highlighter' ? 'square' : 'round';
  ctx.lineJoin = 'round';
  catmullRomSpline(obj.points, ctx);
  ctx.stroke();
  ctx.restore();
}

function getTextBounds(obj) {
  const lines = (obj.text || '').split('\n');
  const lineH = (obj.fontSize || 24) * 1.3;
  const h = lines.length * lineH;

  annCtx.save();
  annCtx.font = `${obj.fontSize || 24}px ${obj.font || 'Arial, sans-serif'}`;
  let maxW = 0;
  for (const line of lines) {
    const w = annCtx.measureText(line).width;
    if (w > maxW) maxW = w;
  }
  annCtx.restore();

  return { x: obj.x, y: obj.y, w: Math.max(30, maxW + 10), h: Math.max(20, h) };
}

function getObjectBounds(obj) {
  if (obj.type === 'arrow') {
    const minX = Math.min(obj.x1, obj.x2);
    const maxX = Math.max(obj.x1, obj.x2);
    const minY = Math.min(obj.y1, obj.y2);
    const maxY = Math.max(obj.y1, obj.y2);
    return { x: minX, y: minY, w: Math.max(20, maxX - minX), h: Math.max(20, maxY - minY) };
  }
  if (obj.type === 'text') return getTextBounds(obj);
  if (obj.type === 'image' || obj.type === 'rect') {
    return {
      x: Math.min(obj.x, obj.x + obj.w),
      y: Math.min(obj.y, obj.y + obj.h),
      w: Math.abs(obj.w),
      h: Math.abs(obj.h)
    };
  }
  if (obj.type === 'ellipse') {
    return {
      x: obj.cx - Math.abs(obj.rx),
      y: obj.cy - Math.abs(obj.ry),
      w: Math.abs(obj.rx) * 2,
      h: Math.abs(obj.ry) * 2
    };
  }
  if (obj.type === 'counter') {
    const r = Math.max(16, (obj.fontSize || 24) * 0.75);
    return { x: obj.x - r, y: obj.y - r, w: r * 2, h: r * 2 };
  }
  if (obj.type === 'doodle') {
    if (!obj.points || !obj.points.length) return { x: 0, y: 0, w: 0, h: 0 };
    let minX = obj.points[0].x, maxX = obj.points[0].x;
    let minY = obj.points[0].y, maxY = obj.points[0].y;
    for (let i = 1; i < obj.points.length; i++) {
      const pt = obj.points[i];
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    const pad = Math.max(8, (obj.strokeWidth || 3) * 2);
    return {
      x: minX - pad,
      y: minY - pad,
      w: Math.max(24, maxX - minX + pad * 2),
      h: Math.max(24, maxY - minY + pad * 2)
    };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

function drawSelectionBox(ctx, obj) {
  ctx.save();
  ctx.strokeStyle = '#4f8ef7';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);

  if (obj.type === 'arrow') {
    // For arrows, draw line connecting endpoints and circular handles at endpoints
    ctx.beginPath();
    ctx.moveTo(obj.x1, obj.y1);
    ctx.lineTo(obj.x2, obj.y2);
    ctx.stroke();

    ctx.setLineDash([]);
    drawCircleHandle(ctx, obj.x1, obj.y1, 'start');
    drawCircleHandle(ctx, obj.x2, obj.y2, 'end');

    // Draw Delete button handle near midpoint
    const mx = (obj.x1 + obj.x2) / 2;
    const my = (obj.y1 + obj.y2) / 2;
    drawDeleteHandle(ctx, mx, my - 16);
  } else {
    const b = getObjectBounds(obj);
    const pad = 4;
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);

    ctx.setLineDash([]);
    drawSquareHandle(ctx, b.x - pad, b.y - pad, 'tl');
    drawSquareHandle(ctx, b.x + b.w + pad, b.y - pad, 'tr');
    drawSquareHandle(ctx, b.x - pad, b.y + b.h + pad, 'bl');
    drawSquareHandle(ctx, b.x + b.w + pad, b.y + b.h + pad, 'br');

    // Draw Delete button handle at top-right
    drawDeleteHandle(ctx, b.x + b.w + pad + 14, b.y - pad - 6);
  }
  ctx.restore();
}

function drawSquareHandle(ctx, x, y, name) {
  const size = 9;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#4f8ef7';
  ctx.lineWidth = 2;
  ctx.fillRect(x - size / 2, y - size / 2, size, size);
  ctx.strokeRect(x - size / 2, y - size / 2, size, size);
}

function drawCircleHandle(ctx, x, y, name) {
  const r = 6;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#4f8ef7';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawDeleteHandle(ctx, x, y) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fillStyle = '#ef4444';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Draw 'X' inside
  ctx.beginPath();
  ctx.moveTo(x - 3.5, y - 3.5);
  ctx.lineTo(x + 3.5, y + 3.5);
  ctx.moveTo(x + 3.5, y - 3.5);
  ctx.lineTo(x - 3.5, y + 3.5);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}

function hitTestHandles(p, obj) {
  if (!obj) return null;
  const radius = 13;

  if (obj.type === 'arrow') {
    const mx = (obj.x1 + obj.x2) / 2;
    const my = (obj.y1 + obj.y2) / 2;
    if (Math.hypot(p.x - mx, p.y - (my - 16)) <= radius) return 'delete';
    if (Math.hypot(p.x - obj.x1, p.y - obj.y1) <= radius) return 'start';
    if (Math.hypot(p.x - obj.x2, p.y - obj.y2) <= radius) return 'end';
    return null;
  }

  const b = getObjectBounds(obj);
  const pad = 4;
  const delPos = { x: b.x + b.w + pad + 14, y: b.y - pad - 6 };
  if (Math.hypot(p.x - delPos.x, p.y - delPos.y) <= radius) return 'delete';

  const handles = {
    tl: { x: b.x - pad, y: b.y - pad },
    tr: { x: b.x + b.w + pad, y: b.y - pad },
    bl: { x: b.x - pad, y: b.y + b.h + pad },
    br: { x: b.x + b.w + pad, y: b.y + b.h + pad }
  };

  for (const [name, pos] of Object.entries(handles)) {
    if (Math.hypot(p.x - pos.x, p.y - pos.y) <= radius) {
      return name;
    }
  }
  return null;
}

function distToSegment(p, v, w) {
  const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
}

function hitTestObject(p) {
  for (let i = state.objects.length - 1; i >= 0; i--) {
    const obj = state.objects[i];
    if (obj.type === 'arrow') {
      const d = distToSegment(p, { x: obj.x1, y: obj.y1 }, { x: obj.x2, y: obj.y2 });
      if (d <= Math.max(12, (obj.strokeWidth || 3) * 2.5)) return obj;
    } else if (obj.type === 'ellipse') {
      const dx = (p.x - obj.cx) / Math.max(1, Math.abs(obj.rx));
      const dy = (p.y - obj.cy) / Math.max(1, Math.abs(obj.ry));
      if (dx * dx + dy * dy <= 1.15) return obj;
    } else if (obj.type === 'counter') {
      const r = Math.max(16, (obj.fontSize || 24) * 0.75);
      if (Math.hypot(p.x - obj.x, p.y - obj.y) <= r + 6) return obj;
    } else if (obj.type === 'doodle') {
      const b = getObjectBounds(obj);
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        const threshold = Math.max(12, (obj.strokeWidth || 3) * (obj.tool === 'highlighter' ? 3.5 : 2));
        for (let j = 0; j < obj.points.length - 1; j++) {
          const d = distToSegment(p, obj.points[j], obj.points[j + 1]);
          if (d <= threshold) return obj;
        }
      }
    } else {
      const b = getObjectBounds(obj);
      if (p.x >= b.x - 4 && p.x <= b.x + b.w + 4 && p.y >= b.y - 4 && p.y <= b.y + b.h + 4) {
        return obj;
      }
    }
  }
  return null;
}

// ─── Drawing Primitives for Objects ───────────────────────────────────────
function drawArrowObj(ctx, obj) {
  ctx.save();
  ctx.globalAlpha = obj.strokeOpacity ?? 1;
  ctx.strokeStyle = obj.strokeColor || '#FFD600';
  ctx.lineWidth = obj.strokeWidth || 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const type = obj.arrowType || 'arrow-solid';
  const headSize = Math.max(12, (obj.strokeWidth || 3) * 4);
  const angle = Math.atan2(obj.y2 - obj.y1, obj.x2 - obj.x1);

  if (type === 'line') {
    ctx.beginPath();
    ctx.moveTo(obj.x1, obj.y1);
    ctx.lineTo(obj.x2, obj.y2);
    ctx.stroke();
  } else if (type === 'line-dashed') {
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.moveTo(obj.x1, obj.y1);
    ctx.lineTo(obj.x2, obj.y2);
    ctx.stroke();
  } else if (type === 'arrow-solid') {
    ctx.beginPath();
    ctx.moveTo(obj.x1, obj.y1);
    ctx.lineTo(obj.x2, obj.y2);
    ctx.stroke();
    drawArrowHeadOnCtx(ctx, obj.x2, obj.y2, angle, headSize, obj.strokeColor);
  } else if (type === 'arrow-double') {
    ctx.beginPath();
    ctx.moveTo(obj.x1, obj.y1);
    ctx.lineTo(obj.x2, obj.y2);
    ctx.stroke();
    drawArrowHeadOnCtx(ctx, obj.x2, obj.y2, angle, headSize, obj.strokeColor);
    drawArrowHeadOnCtx(ctx, obj.x1, obj.y1, angle + Math.PI, headSize, obj.strokeColor);
  } else if (type === 'arrow-curved') {
    const mx = (obj.x1 + obj.x2) / 2, my = (obj.y1 + obj.y2) / 2;
    const cpx = mx - (obj.y2 - obj.y1) * 0.4;
    const cpy = my + (obj.x2 - obj.x1) * 0.4;
    ctx.beginPath();
    ctx.moveTo(obj.x1, obj.y1);
    ctx.quadraticCurveTo(cpx, cpy, obj.x2, obj.y2);
    ctx.stroke();
    const endAngle = Math.atan2(obj.y2 - cpy, obj.x2 - cpx);
    drawArrowHeadOnCtx(ctx, obj.x2, obj.y2, endAngle, headSize, obj.strokeColor);
  }
  ctx.restore();
}

function drawArrowHeadOnCtx(ctx, x, y, angle, size, color) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(
    x - size * Math.cos(angle - Math.PI / 7),
    y - size * Math.sin(angle - Math.PI / 7)
  );
  ctx.lineTo(
    x - size * Math.cos(angle + Math.PI / 7),
    y - size * Math.sin(angle + Math.PI / 7)
  );
  ctx.closePath();
  ctx.fillStyle = color || '#FFD600';
  ctx.fill();
  ctx.restore();
}

function drawTextObj(ctx, obj) {
  ctx.save();
  ctx.globalAlpha = obj.opacity ?? 1;
  ctx.fillStyle = obj.color || '#FFD600';
  ctx.font = `${obj.fontSize || 24}px ${obj.font || 'Arial, sans-serif'}`;
  ctx.textBaseline = 'top';
  const lines = (obj.text || '').split('\n');
  const lineH = (obj.fontSize || 24) * 1.3;
  lines.forEach((line, i) => {
    ctx.fillText(line, obj.x, obj.y + i * lineH);
  });
  ctx.restore();
}

function drawImageObj(ctx, obj) {
  if (obj.img && obj.img.complete) {
    ctx.drawImage(obj.img, obj.x, obj.y, obj.w, obj.h);
  }
}

function drawRectObj(ctx, obj) {
  ctx.save();
  if (obj.fillOpacity > 0) {
    ctx.globalAlpha = obj.fillOpacity;
    ctx.fillStyle = obj.fillColor;
    ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
  }
  ctx.globalAlpha = obj.strokeOpacity ?? 1;
  ctx.strokeStyle = obj.strokeColor;
  ctx.lineWidth = obj.strokeWidth;
  ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
  ctx.restore();
}

function drawEllipseObj(ctx, obj) {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(obj.cx, obj.cy, Math.abs(obj.rx), Math.abs(obj.ry), 0, 0, Math.PI * 2);
  if (obj.fillOpacity > 0) {
    ctx.globalAlpha = obj.fillOpacity;
    ctx.fillStyle = obj.fillColor;
    ctx.fill();
  }
  ctx.globalAlpha = obj.strokeOpacity ?? 1;
  ctx.strokeStyle = obj.strokeColor;
  ctx.lineWidth = obj.strokeWidth;
  ctx.stroke();
  ctx.restore();
}

function drawCounterObj(ctx, obj) {
  const r = Math.max(16, (obj.fontSize || 24) * 0.75);
  ctx.save();
  ctx.globalAlpha = obj.strokeOpacity ?? 1;
  ctx.beginPath();
  ctx.arc(obj.x, obj.y, r, 0, Math.PI * 2);
  ctx.fillStyle = obj.strokeColor || '#FFD600';
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.round(r * 1.1)}px 'Inter', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(obj.num), obj.x, obj.y);
  ctx.restore();
}

// ─── Canvas Pointer Events (Drawing & Selection Engine) ───────────────────
annCanvas.addEventListener('mousedown', onPointerDown);
annCanvas.addEventListener('mousemove', onPointerMove);
annCanvas.addEventListener('mouseup', onPointerUp);
annCanvas.addEventListener('mouseleave', onPointerUp);

function onPointerDown(e) {
  if (e.button !== 0) return;
  const p = getCanvasPoint(e);

  if (state.tool === 'text') {
    placeTextInput(p.x, p.y);
    return;
  }
  if (state.tool === 'crop') return;
  if (state.tool === 'image') return;

  // ─── Select Tool Interaction ──────────────────────────────────
  if (state.tool === 'select') {
    // 1. Check if clicking on a handle of selected object
    if (state.selectedObject) {
      const handle = hitTestHandles(p, state.selectedObject);
      if (handle === 'delete') {
        saveUndo();
        state.objects = state.objects.filter(o => o !== state.selectedObject);
        state.selectedObject = null;
        renderAll();
        showToast('Deleted element ✓', 'info');
        return;
      }
      if (handle) {
        state.dragMode = 'handle';
        state.activeHandle = handle;
        state.dragStart = { ...p };
        state.dragInitialObj = cloneObject(state.selectedObject);
        state.dragInitialBounds = getObjectBounds(state.selectedObject);
        return;
      }
    }

    // 2. Check if clicking directly on an object
    const hit = hitTestObject(p);
    if (hit) {
      state.selectedObject = hit;
      state.dragMode = 'move';
      state.dragStart = { ...p };
      state.dragInitialObj = cloneObject(hit);
      state.dragInitialBounds = getObjectBounds(hit);
      syncToolbarToSelected(hit);
      renderAll();
      return;
    }

    // 3. Clicked empty space — deselect
    state.selectedObject = null;
    renderAll();
    return;
  }

  // ─── Drawing Tools ────────────────────────────────────────────
  state.isDrawing = true;
  state.startX = p.x; state.startY = p.y;
  state.lastX = p.x; state.lastY = p.y;
  state.penPoints = [{ x: p.x, y: p.y }];

  if (state.tool === 'blur-brush') {
    saveUndo();
    applyBrushBlur(p.x, p.y);
  }
  if (state.tool === 'eraser') {
    saveUndo();
    eraseAt(p.x, p.y);
  }
  if (state.tool === 'counter') {
    saveUndo();
    drawCounter(p.x, p.y);
    state.isDrawing = false;
  }
}

function onPointerMove(e) {
  const p = getCanvasPoint(e);

  // ─── Select Tool Dragging ─────────────────────────────────────
  if (state.tool === 'select') {
    if (state.dragMode === 'move' && state.selectedObject && state.dragInitialObj) {
      const dx = p.x - state.dragStart.x;
      const dy = p.y - state.dragStart.y;
      const init = state.dragInitialObj;
      const obj = state.selectedObject;

      if (obj.type === 'arrow') {
        obj.x1 = Math.round(init.x1 + dx);
        obj.y1 = Math.round(init.y1 + dy);
        obj.x2 = Math.round(init.x2 + dx);
        obj.y2 = Math.round(init.y2 + dy);
      } else if (obj.type === 'ellipse') {
        obj.cx = Math.round(init.cx + dx);
        obj.cy = Math.round(init.cy + dy);
      } else if (obj.type === 'doodle') {
        obj.points = init.points.map(pt => ({
          x: Math.round(pt.x + dx),
          y: Math.round(pt.y + dy)
        }));
      } else {
        obj.x = Math.round(init.x + dx);
        obj.y = Math.round(init.y + dy);
      }
      renderAll();
      return;
    }

    if (state.dragMode === 'handle' && state.selectedObject && state.dragInitialObj) {
      const dx = p.x - state.dragStart.x;
      const dy = p.y - state.dragStart.y;
      const init = state.dragInitialObj;
      const obj = state.selectedObject;
      const h = state.activeHandle;

      if (obj.type === 'arrow') {
        if (h === 'start') { obj.x1 = Math.round(p.x); obj.y1 = Math.round(p.y); }
        if (h === 'end') { obj.x2 = Math.round(p.x); obj.y2 = Math.round(p.y); }
      } else if (obj.type === 'image' || obj.type === 'rect') {
        if (h === 'br') {
          obj.w = Math.max(20, Math.round(init.w + dx));
          obj.h = Math.max(20, Math.round(init.h + dy));
        } else if (h === 'bl') {
          const newW = init.w - dx;
          if (newW >= 20) { obj.x = Math.round(init.x + dx); obj.w = Math.round(newW); }
          obj.h = Math.max(20, Math.round(init.h + dy));
        } else if (h === 'tr') {
          obj.w = Math.max(20, Math.round(init.w + dx));
          const newH = init.h - dy;
          if (newH >= 20) { obj.y = Math.round(init.y + dy); obj.h = Math.round(newH); }
        } else if (h === 'tl') {
          const newW = init.w - dx;
          const newH = init.h - dy;
          if (newW >= 20) { obj.x = Math.round(init.x + dx); obj.w = Math.round(newW); }
          if (newH >= 20) { obj.y = Math.round(init.y + dy); obj.h = Math.round(newH); }
        }
      } else if (obj.type === 'ellipse') {
        obj.rx = Math.max(10, Math.abs(init.rx + dx));
        obj.ry = Math.max(10, Math.abs(init.ry + dy));
      } else if (obj.type === 'counter') {
        const initB = state.dragInitialBounds;
        const scale = Math.max(0.4, (initB.w + (h.includes('r') ? dx : -dx)) / initB.w);
        obj.fontSize = Math.max(12, Math.round((init.fontSize || 24) * scale));
      } else if (obj.type === 'text') {
        const initB = state.dragInitialBounds || getTextBounds(init);
        const factor = (h === 'bl' || h === 'tl') ? -dx : dx;
        const ratio = Math.max(0.3, (initB.w + factor) / initB.w);
        obj.fontSize = Math.max(10, Math.min(300, Math.round((init.fontSize || 24) * ratio)));
        const fsInput = document.getElementById('font-size-input');
        if (fsInput) fsInput.value = obj.fontSize;
      } else if (obj.type === 'doodle') {
        const initB = state.dragInitialBounds;
        if (initB && initB.w > 0 && initB.h > 0) {
          let newX = initB.x, newY = initB.y, newW = initB.w, newH = initB.h;
          if (h === 'br') {
            newW = Math.max(20, initB.w + dx);
            newH = Math.max(20, initB.h + dy);
          } else if (h === 'bl') {
            newW = Math.max(20, initB.w - dx);
            newX = initB.x + (initB.w - newW);
            newH = Math.max(20, initB.h + dy);
          } else if (h === 'tr') {
            newW = Math.max(20, initB.w + dx);
            newH = Math.max(20, initB.h - dy);
            newY = initB.y + (initB.h - newH);
          } else if (h === 'tl') {
            newW = Math.max(20, initB.w - dx);
            newX = initB.x + (initB.w - newW);
            newH = Math.max(20, initB.h - dy);
            newY = initB.y + (initB.h - newH);
          }
          const scaleX = newW / initB.w;
          const scaleY = newH / initB.h;
          obj.points = init.points.map(pt => ({
            x: Math.round(newX + (pt.x - initB.x) * scaleX),
            y: Math.round(newY + (pt.y - initB.y) * scaleY)
          }));
        }
      }
      renderAll();
      return;
    }

    // Cursor hover style in select tool
    if (state.selectedObject) {
      const handle = hitTestHandles(p, state.selectedObject);
      if (handle === 'delete') {
        annCanvas.style.cursor = 'pointer';
        return;
      }
      if (handle) {
        if (state.selectedObject.type === 'arrow') annCanvas.style.cursor = 'crosshair';
        else if (handle === 'tl' || handle === 'br') annCanvas.style.cursor = 'nwse-resize';
        else if (handle === 'tr' || handle === 'bl') annCanvas.style.cursor = 'nesw-resize';
        return;
      }
    }
    const hoverObj = hitTestObject(p);
    annCanvas.style.cursor = hoverObj ? 'move' : 'default';
    return;
  }

  // ─── Drawing Tool Dragging ────────────────────────────────────
  if (!state.isDrawing) return;

  if (state.tool === 'pen' || state.tool === 'highlighter') {
    state.penPoints.push({ x: p.x, y: p.y });
    renderAll();
    drawLiveDoodle(annCtx, state.tool);
  } else if (state.tool === 'eraser') {
    eraseAt(p.x, p.y);
  } else if (state.tool === 'blur-brush') {
    applyBrushBlur(p.x, p.y);
  } else if (state.tool === 'rect') {
    previewRect(p.x, p.y);
  } else if (state.tool === 'ellipse') {
    previewEllipse(p.x, p.y);
  } else if (state.tool === 'arrow') {
    previewArrow(p.x, p.y);
  } else if (state.tool === 'blur-rect') {
    previewBlurRect(p.x, p.y);
  }

  state.lastX = p.x; state.lastY = p.y;
}

function onPointerUp(e) {
  const p = e ? getCanvasPoint(e) : { x: state.lastX, y: state.lastY };

  // ─── Select Tool Drag End ─────────────────────────────────────
  if (state.tool === 'select') {
    if (state.dragMode) {
      saveUndo();
      state.dragMode = null;
      state.activeHandle = null;
      state.dragInitialObj = null;
      state.dragInitialBounds = null;
    }
    return;
  }

  // ─── Drawing Tool Up ──────────────────────────────────────────
  if (!state.isDrawing) return;
  state.isDrawing = false;

  if (state.tool === 'rect') {
    finalizeRect(p.x, p.y);
  } else if (state.tool === 'ellipse') {
    finalizeEllipse(p.x, p.y);
  } else if (state.tool === 'arrow') {
    finalizeArrow(p.x, p.y);
  } else if (state.tool === 'blur-rect') {
    finalizeBlurRect(p.x, p.y);
  } else if ((state.tool === 'pen' || state.tool === 'highlighter') && state.penPoints.length >= 2) {
    saveUndo();
    const obj = {
      id: 'doodle_' + Date.now() + '_' + Math.random(),
      type: 'doodle',
      tool: state.tool,
      points: state.penPoints.map(pt => ({ x: Math.round(pt.x), y: Math.round(pt.y) })),
      strokeColor: state.strokeColor,
      strokeWidth: state.strokeWidth,
      strokeOpacity: state.tool === 'highlighter' ? 0.35 : state.strokeOpacity
    };
    state.objects.push(obj);
    state.selectedObject = obj;
    selectTool('select');
    renderAll();
  }

  state.penPoints = [];
}

// ─── Pen & Splines ────────────────────────────────────────────────────────
function catmullRomSpline(pts, ctx) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}

function drawLiveDoodle(ctx, tool) {
  if (state.penPoints.length < 2) return;
  ctx.save();
  ctx.globalAlpha = tool === 'highlighter' ? 0.35 : state.strokeOpacity;
  ctx.strokeStyle = state.strokeColor;
  ctx.lineWidth = tool === 'highlighter' ? state.strokeWidth * 3.5 : state.strokeWidth;
  ctx.lineCap = tool === 'highlighter' ? 'square' : 'round';
  ctx.lineJoin = 'round';
  catmullRomSpline(state.penPoints, ctx);
  ctx.stroke();
  ctx.restore();
}

function eraseAt(x, y) {
  const r = state.strokeWidth * 4;
  drawingCtx.save();
  drawingCtx.globalCompositeOperation = 'destination-out';
  drawingCtx.beginPath();
  drawingCtx.arc(x, y, r, 0, Math.PI * 2);
  drawingCtx.fill();
  drawingCtx.restore();

  const hit = hitTestObject({ x, y });
  if (hit) {
    state.objects = state.objects.filter(o => o !== hit);
    if (state.selectedObject === hit) state.selectedObject = null;
  }
  renderAll();
}

// ─── Shape Creation & Previews ────────────────────────────────────────────
function previewRect(ex, ey) {
  renderAll();
  const rx = Math.min(state.startX, ex), ry = Math.min(state.startY, ey);
  const rw = Math.abs(ex - state.startX), rh = Math.abs(ey - state.startY);
  drawRectObj(annCtx, {
    type: 'rect',
    x: rx, y: ry, w: rw, h: rh,
    strokeColor: state.strokeColor,
    strokeWidth: state.strokeWidth,
    strokeOpacity: state.strokeOpacity,
    fillColor: state.fillColor,
    fillOpacity: state.fillOpacity
  });
}

function finalizeRect(ex, ey) {
  const rx = Math.min(state.startX, ex), ry = Math.min(state.startY, ey);
  const rw = Math.abs(ex - state.startX), rh = Math.abs(ey - state.startY);
  if (rw < 5 && rh < 5) return;

  saveUndo();
  const obj = {
    id: 'rect_' + Date.now() + '_' + Math.random(),
    type: 'rect',
    x: Math.round(rx), y: Math.round(ry),
    w: Math.round(rw), h: Math.round(rh),
    strokeColor: state.strokeColor,
    strokeWidth: state.strokeWidth,
    strokeOpacity: state.strokeOpacity,
    fillColor: state.fillColor,
    fillOpacity: state.fillOpacity
  };
  state.objects.push(obj);
  state.selectedObject = obj;
  selectTool('select');
  renderAll();
}

function previewEllipse(ex, ey) {
  renderAll();
  const cx = (state.startX + ex) / 2, cy = (state.startY + ey) / 2;
  const rx = Math.abs(ex - state.startX) / 2, ry = Math.abs(ey - state.startY) / 2;
  drawEllipseObj(annCtx, {
    type: 'ellipse',
    cx, cy, rx, ry,
    strokeColor: state.strokeColor,
    strokeWidth: state.strokeWidth,
    strokeOpacity: state.strokeOpacity,
    fillColor: state.fillColor,
    fillOpacity: state.fillOpacity
  });
}

function finalizeEllipse(ex, ey) {
  const cx = (state.startX + ex) / 2, cy = (state.startY + ey) / 2;
  const rx = Math.abs(ex - state.startX) / 2, ry = Math.abs(ey - state.startY) / 2;
  if (rx < 4 && ry < 4) return;

  saveUndo();
  const obj = {
    id: 'ell_' + Date.now() + '_' + Math.random(),
    type: 'ellipse',
    cx: Math.round(cx), cy: Math.round(cy),
    rx: Math.round(rx), ry: Math.round(ry),
    strokeColor: state.strokeColor,
    strokeWidth: state.strokeWidth,
    strokeOpacity: state.strokeOpacity,
    fillColor: state.fillColor,
    fillOpacity: state.fillOpacity
  };
  state.objects.push(obj);
  state.selectedObject = obj;
  selectTool('select');
  renderAll();
}

function previewArrow(ex, ey) {
  renderAll();
  drawArrowObj(annCtx, {
    type: 'arrow',
    x1: state.startX, y1: state.startY,
    x2: ex, y2: ey,
    arrowType: state.arrowType,
    strokeColor: state.strokeColor,
    strokeWidth: state.strokeWidth,
    strokeOpacity: state.strokeOpacity
  });
}

function finalizeArrow(ex, ey) {
  if (Math.hypot(ex - state.startX, ey - state.startY) < 5) return;

  saveUndo();
  const obj = {
    id: 'arr_' + Date.now() + '_' + Math.random(),
    type: 'arrow',
    x1: Math.round(state.startX), y1: Math.round(state.startY),
    x2: Math.round(ex), y2: Math.round(ey),
    arrowType: state.arrowType,
    strokeColor: state.strokeColor,
    strokeWidth: state.strokeWidth,
    strokeOpacity: state.strokeOpacity
  };
  state.objects.push(obj);
  state.selectedObject = obj;
  selectTool('select');
  renderAll();
}

function drawCounter(x, y) {
  saveUndo();
  const obj = {
    id: 'cnt_' + Date.now() + '_' + Math.random(),
    type: 'counter',
    x: Math.round(x),
    y: Math.round(y),
    num: state.counterVal,
    fontSize: state.fontSize,
    strokeColor: state.strokeColor,
    strokeOpacity: state.strokeOpacity
  };
  state.counterVal++;
  state.objects.push(obj);
  state.selectedObject = obj;
  selectTool('select');
  renderAll();
}

// ─── Blur Engine ──────────────────────────────────────────────────────────
function previewBlurRect(ex, ey) {
  renderAll();
  const rx = Math.min(state.startX, ex), ry = Math.min(state.startY, ey);
  const rw = Math.abs(ex - state.startX), rh = Math.abs(ey - state.startY);
  annCtx.save();
  annCtx.globalAlpha = 0.6;
  annCtx.strokeStyle = '#4f8ef7';
  annCtx.lineWidth = 2;
  annCtx.setLineDash([6, 3]);
  annCtx.strokeRect(rx, ry, rw, rh);
  annCtx.restore();
}

function finalizeBlurRect(ex, ey) {
  renderAll();
  const rx = Math.round(Math.min(state.startX, ex));
  const ry = Math.round(Math.min(state.startY, ey));
  const rw = Math.round(Math.abs(ex - state.startX));
  const rh = Math.round(Math.abs(ey - state.startY));
  if (rw < 5 || rh < 5) return;

  saveUndo();
  applyRectBlur(rx, ry, rw, rh, state.blurLevel);
}

function applyRectBlur(rx, ry, rw, rh, level) {
  const flat = flattenCanvas();
  const tempImg = new Image();
  tempImg.onload = () => {
    const tc = document.createElement('canvas');
    tc.width = canvasW; tc.height = canvasH;
    const tctx = tc.getContext('2d');
    tctx.drawImage(tempImg, 0, 0);

    const radius = Math.max(2, level * 2);
    const imgData = tctx.getImageData(rx, ry, rw, rh);
    const blurred = boxBlur(imgData, radius);
    const pixelSize = Math.max(3, level);
    pixelate(blurred, rw, rh, pixelSize);
    tctx.putImageData(blurred, rx, ry);

    baseCtx.drawImage(tc, rx, ry, rw, rh, rx, ry, rw, rh);
    renderAll();
  };
  tempImg.src = flat;
}

function applyBrushBlur(cx, cy) {
  const r = state.blurBrushSize;
  const rx = Math.max(0, Math.round(cx - r));
  const ry = Math.max(0, Math.round(cy - r));
  const rw = Math.min(canvasW - rx, r * 2);
  const rh = Math.min(canvasH - ry, r * 2);
  if (rw <= 0 || rh <= 0) return;

  const imgData = baseCtx.getImageData(rx, ry, rw, rh);
  const blurred = boxBlur(imgData, Math.max(3, state.blurLevel * 2));
  const pixelSize = Math.max(3, state.blurLevel);
  pixelate(blurred, rw, rh, pixelSize);
  baseCtx.putImageData(blurred, rx, ry);
  renderAll();
}

function boxBlur(imgData, radius) {
  const { width: w, height: h, data } = imgData;
  const out = new Uint8ClampedArray(data);
  const r = Math.floor(radius);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let ky = -r; ky <= r; ky += 2) {
        for (let kx = -r; kx <= r; kx += 2) {
          const px = Math.min(w - 1, Math.max(0, x + kx));
          const py = Math.min(h - 1, Math.max(0, y + ky));
          const idx = (py * w + px) * 4;
          rSum += data[idx]; gSum += data[idx + 1]; bSum += data[idx + 2];
          count++;
        }
      }
      const i = (y * w + x) * 4;
      out[i] = rSum / count; out[i + 1] = gSum / count; out[i + 2] = bSum / count; out[i + 3] = data[i + 3];
    }
  }
  return new ImageData(out, w, h);
}

function pixelate(imgData, w, h, pixelSize) {
  const { data } = imgData;
  for (let y = 0; y < h; y += pixelSize) {
    for (let x = 0; x < w; x += pixelSize) {
      const idx = (y * w + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      for (let py = 0; py < pixelSize && y + py < h; py++) {
        for (let px = 0; px < pixelSize && x + px < w; px++) {
          const i = ((y + py) * w + (x + px)) * 4;
          data[i] = r; data[i + 1] = g; data[i + 2] = b;
        }
      }
    }
  }
}

// ─── Flatten Canvas for Export ────────────────────────────────────────────
function flattenCanvas() {
  const tc = document.createElement('canvas');
  tc.width = canvasW; tc.height = canvasH;
  const tctx = tc.getContext('2d');
  tctx.drawImage(baseCanvas, 0, 0);
  tctx.drawImage(drawingCanvas, 0, 0);
  for (const obj of state.objects) {
    drawObject(tctx, obj);
  }
  return tc.toDataURL('image/png');
}

// ─── Export Functions ─────────────────────────────────────────────────────
async function downloadFile(url, filename) {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  try {
    const prefs = await api.storage.local.get(['prefSaveLocation', 'prefSavePrompt']);
    let path = filename;
    if (prefs.prefSaveLocation) {
      let subDir = prefs.prefSaveLocation.trim().replace(/^[\/\\]+|[\/\\]+$/g, '');
      // If user typed "Downloads" or "Downloads/subfolder", strip the leading "Downloads"
      subDir = subDir.replace(/^downloads[\/\\]?/i, '').trim();
      if (subDir) {
        path = `${subDir}/${filename}`;
      }
    }
    const saveAs = prefs.prefSavePrompt === 'true' || prefs.prefSavePrompt === true;

    if (api && api.downloads && api.downloads.download) {
      await api.downloads.download({
        url: url,
        filename: path,
        saveAs: saveAs
      });
      return;
    }
  } catch (err) {
    console.warn('api.downloads.download failed, falling back to anchor download:', err);
  }

  // Fallback anchor tag
  const a = document.createElement('a');
  a.download = filename;
  a.href = url;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 100);
}

async function exportPNG() {
  const dataUrl = flattenCanvas();
  await downloadFile(dataUrl, `capturex_${Date.now()}.png`);
  showToast('Saved as PNG ✓', 'success');
  closeAllDropdowns();
}

async function exportPDFSingle() {
  const { jsPDF } = window.jspdf;
  const dataUrl = flattenCanvas();
  const pageW = canvasW * 0.264583; // px to mm (96dpi)
  const pageH = canvasH * 0.264583;
  const pdf = new jsPDF({ orientation: pageW > pageH ? 'l' : 'p', unit: 'mm', format: [pageW, pageH] });
  pdf.addImage(dataUrl, 'PNG', 0, 0, pageW, pageH, '', 'FAST');
  const blob = pdf.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  await downloadFile(blobUrl, `capturex_${Date.now()}.pdf`);
  URL.revokeObjectURL(blobUrl);
  showToast('Saved as single-page PDF ✓', 'success');
  closeAllDropdowns();
}

async function exportPDFMulti() {
  const { jsPDF } = window.jspdf;
  const pageSize = document.getElementById('pdf-page-size').value;
  const dataUrl = flattenCanvas();

  const pageSizes = {
    a4:     { w: 210, h: 297 },
    a3:     { w: 297, h: 420 },
    letter: { w: 215.9, h: 279.4 },
    legal:  { w: 215.9, h: 355.6 }
  };
  const ps = pageSizes[pageSize] || pageSizes.a4;

  const scale = ps.w / canvasW;
  const scaledW = ps.w;
  const scaledH = canvasH * scale;

  const pagesNeeded = Math.max(1, Math.ceil(scaledH / ps.h));
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: pageSize });

  for (let page = 0; page < pagesNeeded; page++) {
    if (page > 0) pdf.addPage(pageSize, 'p');
    const offsetY = -(page * ps.h);
    pdf.addImage(dataUrl, 'PNG', 0, offsetY, scaledW, scaledH, '', 'FAST');
  }

  const blob = pdf.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  await downloadFile(blobUrl, `capturex_multipage_${Date.now()}.pdf`);
  URL.revokeObjectURL(blobUrl);
  showToast(`Saved as ${pagesNeeded}-page PDF ✓`, 'success');
  closeAllDropdowns();
}

// ─── Resize Canvas Dialog ─────────────────────────────────────────────────
document.getElementById('resize-btn').addEventListener('click', () => {
  document.getElementById('resize-w').value = canvasW;
  document.getElementById('resize-h').value = canvasH;
  document.getElementById('resize-dialog').style.display = 'flex';
});

document.getElementById('resize-cancel').addEventListener('click', () => {
  document.getElementById('resize-dialog').style.display = 'none';
});

document.getElementById('resize-apply').addEventListener('click', () => {
  const w = parseInt(document.getElementById('resize-w').value);
  const h = parseInt(document.getElementById('resize-h').value);
  if (!w || !h) return;
  resizeCanvas(w, h);
  document.getElementById('resize-dialog').style.display = 'none';
});

const propCheck = document.getElementById('resize-proportional');
document.getElementById('resize-w').addEventListener('input', (e) => {
  if (propCheck.checked && canvasW > 0) {
    const ratio = canvasH / canvasW;
    document.getElementById('resize-h').value = Math.round(parseInt(e.target.value) * ratio);
  }
});
document.getElementById('resize-h').addEventListener('input', (e) => {
  if (propCheck.checked && canvasH > 0) {
    const ratio = canvasW / canvasH;
    document.getElementById('resize-w').value = Math.round(parseInt(e.target.value) * ratio);
  }
});

function resizeCanvas(w, h) {
  saveUndo();
  const flat = flattenCanvas();
  setCanvasSize(w, h);
  baseCtx.fillStyle = '#ffffff';
  baseCtx.fillRect(0, 0, w, h);
  const img = new Image();
  img.onload = () => {
    baseCtx.drawImage(img, 0, 0, w, h);
    drawingCtx.clearRect(0, 0, w, h);
    state.objects = [];
    state.selectedObject = null;
    renderAll();
    fitZoom();
  };
  img.src = flat;
}

// ─── Toast Notifications ─────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };

  const iconSpan = document.createElement('span');
  iconSpan.style.color = (type === 'success' ? '#2ecc71' : type === 'error' ? '#e74c3c' : '#4f8ef7');
  iconSpan.textContent = icons[type] || 'ℹ';
  toast.appendChild(iconSpan);

  const textNode = document.createTextNode(' ' + msg);
  toast.appendChild(textNode);

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── Keyboard Shortcuts ──────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (state.textInputActive) return;
  const target = e.target.tagName;
  if (target === 'INPUT' || target === 'TEXTAREA') return;

  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') { e.preventDefault(); undo(); }
    if (e.key === 'y') { e.preventDefault(); redo(); }
    if (e.key === 's') { e.preventDefault(); exportPNG(); }
    return;
  }

  // Delete selected element
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selectedObject) {
      e.preventDefault();
      saveUndo();
      state.objects = state.objects.filter(o => o !== state.selectedObject);
      state.selectedObject = null;
      renderAll();
      showToast('Deleted element', 'info');
      return;
    }
  }

  // Nudge selected element with arrow keys
  if (state.selectedObject && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const obj = state.selectedObject;
    if (e.key === 'ArrowUp') {
      if (obj.type === 'arrow') { obj.y1 -= step; obj.y2 -= step; }
      else if (obj.type === 'ellipse') { obj.cy -= step; }
      else { obj.y -= step; }
    } else if (e.key === 'ArrowDown') {
      if (obj.type === 'arrow') { obj.y1 += step; obj.y2 += step; }
      else if (obj.type === 'ellipse') { obj.cy += step; }
      else { obj.y += step; }
    } else if (e.key === 'ArrowLeft') {
      if (obj.type === 'arrow') { obj.x1 -= step; obj.x2 -= step; }
      else if (obj.type === 'ellipse') { obj.cx -= step; }
      else { obj.x -= step; }
    } else if (e.key === 'ArrowRight') {
      if (obj.type === 'arrow') { obj.x1 += step; obj.x2 += step; }
      else if (obj.type === 'ellipse') { obj.cx += step; }
      else { obj.x += step; }
    }
    renderAll();
    return;
  }

  const keyMap = {
    'v': 'select', 'p': 'pen', 'h': 'highlighter',
    'r': 'rect', 'e': 'ellipse', 'a': 'arrow',
    't': 'text', 'c': 'crop', 'b': 'blur-rect'
  };
  if (keyMap[e.key]) selectTool(keyMap[e.key]);

  if (e.key === '+' || e.key === '=') { state.zoom = Math.min(4, state.zoom + 0.1); applyZoom(); }
  if (e.key === '-') { state.zoom = Math.max(0.1, state.zoom - 0.1); applyZoom(); }
  if (e.key === '0') { state.zoom = 1; applyZoom(); }
  if (e.key === 'Escape') {
    closeAllDropdowns();
    cancelText();
    cancelCrop();
    state.selectedObject = null;
    renderAll();
  }
  if (e.key === 'Enter' && state.cropState) {
    applyCrop();
  }
});

// ─── Initialize ───────────────────────────────────────────────────────────
(async function init() {
  await loadCapture();
  selectTool('select');
  updateUndoButtons();
  showToast('CaptureX Editor ready! Select, move & resize any annotation.', 'info');
})();
