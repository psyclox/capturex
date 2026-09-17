// CaptureX — Content Script (Firefox + Chrome compatible)
// Handles: Region select, Fragment capture, Element hover, Delay countdown

// Firefox/Chrome API compatibility
const _api = (typeof browser !== 'undefined') ? browser : chrome;

(function () {
  'use strict';

  // Prevent double-injection
  if (window.__capturexInjected) return;
  window.__capturexInjected = true;

  let mode = null;
  let overlay = null;
  let startX = 0, startY = 0, endX = 0, endY = 0;
  let isDrawing = false;
  let magnifierCanvas = null, magnifierCtx = null;
  let screenshotDataUrl = null;
  let magnifierImg = null;
  let fragmentHighlight = null;
  let lastHoveredEl = null;

  // ─── Listen for messages from background/popup ───────────────────────────
  _api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse({ ok: true });
      return true;
    } else if (msg.action === 'startRegionSelect') {
      startRegionMode();
      sendResponse({ ok: true });
    } else if (msg.action === 'startFragmentSelect') {
      startFragmentMode();
      sendResponse({ ok: true });
    } else if (msg.action === 'startDelayedCapture') {
      startCountdown(msg.delay || 3);
      sendResponse({ ok: true });
    } else if (msg.action === 'startVisibleCapture') {
      sendResponse({ ok: true });
    }
  });

  // ─── Region Select Mode ─────────────────────────────────────────────────
  function startRegionMode() {
    if (overlay) removeOverlay();
    mode = 'region';
    magnifierImg = null;

    // Request a background screenshot for magnifier
    _api.runtime.sendMessage({ action: 'captureTabScreenshot' }, (res) => {
      if (res && res.dataUrl) {
        screenshotDataUrl = res.dataUrl;
        const img = new Image();
        img.onload = () => {
          magnifierImg = img;
        };
        img.src = res.dataUrl;
      }
    });

    overlay = document.createElement('div');
    overlay.id = 'capturex-overlay';

    const dim = document.createElement('div');
    dim.id = 'capturex-dim';
    overlay.appendChild(dim);

    const hline = document.createElement('div');
    hline.id = 'capturex-hline';
    overlay.appendChild(hline);

    const vline = document.createElement('div');
    vline.id = 'capturex-vline';
    overlay.appendChild(vline);

    const selBox = document.createElement('div');
    selBox.id = 'capturex-selection';
    selBox.style.display = 'none';
    overlay.appendChild(selBox);

    const sizeLabel = document.createElement('div');
    sizeLabel.id = 'capturex-size-label';
    sizeLabel.style.display = 'none';
    overlay.appendChild(sizeLabel);

    // Magnifier
    const mag = document.createElement('div');
    mag.id = 'capturex-magnifier';
    magnifierCanvas = document.createElement('canvas');
    magnifierCanvas.width = 360;
    magnifierCanvas.height = 240;
    magnifierCtx = magnifierCanvas.getContext('2d');
    const magCoords = document.createElement('div');
    magCoords.id = 'capturex-magnifier-coords';
    mag.appendChild(magnifierCanvas);
    mag.appendChild(magCoords);
    overlay.appendChild(mag);

    const tip = document.createElement('div');
    tip.id = 'capturex-tip';
    tip.textContent = 'Drag to select a region  •  ESC to cancel';
    overlay.appendChild(tip);

    document.body.appendChild(overlay);

    overlay.addEventListener('mousedown', onMouseDown);
    overlay.addEventListener('mousemove', onMouseMove);
    overlay.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown);
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    isDrawing = true;
    startX = e.clientX;
    startY = e.clientY;
    endX = e.clientX;
    endY = e.clientY;
    document.getElementById('capturex-selection').style.display = 'block';
    document.getElementById('capturex-size-label').style.display = 'block';
    document.getElementById('capturex-hline').style.display = 'none';
    document.getElementById('capturex-vline').style.display = 'none';
  }

  function onMouseMove(e) {
    const mx = e.clientX, my = e.clientY;

    if (!isDrawing) {
      // Move crosshair
      const hline = document.getElementById('capturex-hline');
      const vline = document.getElementById('capturex-vline');
      if (hline) { hline.style.top = my + 'px'; }
      if (vline) { vline.style.left = mx + 'px'; }
      updateMagnifier(mx, my);
      return;
    }

    endX = mx;
    endY = my;

    const rx = Math.min(startX, endX);
    const ry = Math.min(startY, endY);
    const rw = Math.abs(endX - startX);
    const rh = Math.abs(endY - startY);

    const sel = document.getElementById('capturex-selection');
    if (sel) {
      sel.style.left = rx + 'px';
      sel.style.top = ry + 'px';
      sel.style.width = rw + 'px';
      sel.style.height = rh + 'px';
    }

    const label = document.getElementById('capturex-size-label');
    if (label) {
      label.textContent = `${Math.round(rw * window.devicePixelRatio)} × ${Math.round(rh * window.devicePixelRatio)}`;
      label.style.left = (rx + rw / 2 - 50) + 'px';
      label.style.top = Math.max(ry - 28, 4) + 'px';
    }

    updateMagnifier(mx, my);
  }

  function onMouseUp(e) {
    if (!isDrawing) return;
    isDrawing = false;

    const rw = Math.abs(endX - startX);
    const rh = Math.abs(endY - startY);
    if (rw < 10 || rh < 10) return;

    // Show action toolbar
    showToolbar();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') removeOverlay();
    if (e.key === 'Enter') captureRegion();
  }

  function showToolbar() {
    let tb = document.getElementById('capturex-toolbar');
    if (tb) tb.remove();

    tb = document.createElement('div');
    tb.id = 'capturex-toolbar';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'capturex-btn-cancel';
    cancelBtn.textContent = '✕ Cancel';
    cancelBtn.onclick = () => removeOverlay();

    const retakeBtn = document.createElement('button');
    retakeBtn.textContent = '↩ Retake';
    retakeBtn.onclick = () => {
      tb.remove();
      document.getElementById('capturex-selection').style.display = 'none';
      document.getElementById('capturex-size-label').style.display = 'none';
      document.getElementById('capturex-hline').style.display = 'block';
      document.getElementById('capturex-vline').style.display = 'block';
    };

    const captureBtn = document.createElement('button');
    captureBtn.className = 'capturex-btn-capture';
    captureBtn.textContent = '📸 Capture';
    captureBtn.onclick = () => captureRegion();

    tb.appendChild(cancelBtn);
    tb.appendChild(retakeBtn);
    tb.appendChild(captureBtn);
    overlay.appendChild(tb);
  }

  function updateMagnifier(mx, my) {
    const mag = document.getElementById('capturex-magnifier');
    if (!mag || !magnifierCtx) return;

    // Position magnifier in corner away from cursor
    const vw = window.innerWidth, vh = window.innerHeight;
    const mw = 180, mh = 120;
    let magX = mx + 20, magY = my + 20;
    if (magX + mw > vw) magX = mx - mw - 20;
    if (magY + mh > vh) magY = my - mh - 20;
    mag.style.left = Math.max(0, magX) + 'px';
    mag.style.top = Math.max(0, magY) + 'px';

    const coords = document.getElementById('capturex-magnifier-coords');
    const dpr = window.devicePixelRatio || 1;
    if (coords) {
      coords.textContent = `${Math.round(mx * dpr)}, ${Math.round(my * dpr)}`;
    }

    magnifierCtx.clearRect(0, 0, 360, 240);

    if (magnifierImg && magnifierImg.complete && magnifierImg.naturalWidth > 0) {
      const zoom = 4;
      const srcW = 360 / zoom; // 90px
      const srcH = 240 / zoom; // 60px
      const srcX = Math.max(0, Math.min(magnifierImg.naturalWidth - srcW, mx * dpr - srcW / 2));
      const srcY = Math.max(0, Math.min(magnifierImg.naturalHeight - srcH, my * dpr - srcH / 2));

      magnifierCtx.imageSmoothingEnabled = false;
      magnifierCtx.drawImage(magnifierImg, srcX, srcY, srcW, srcH, 0, 0, 360, 240);
    } else {
      // Clean placeholder while image is ready
      magnifierCtx.fillStyle = '#111420';
      magnifierCtx.fillRect(0, 0, 360, 240);
      magnifierCtx.fillStyle = '#4f8ef7';
      magnifierCtx.font = '600 13px Inter, Segoe UI, sans-serif';
      magnifierCtx.textAlign = 'center';
      magnifierCtx.textBaseline = 'middle';
      magnifierCtx.fillText('Loading Zoom...', 180, 120);
    }

    // Draw crosshair on magnifier
    magnifierCtx.strokeStyle = 'rgba(79,142,247,0.9)';
    magnifierCtx.lineWidth = 1.5;
    magnifierCtx.beginPath();
    magnifierCtx.moveTo(180, 0); magnifierCtx.lineTo(180, 240);
    magnifierCtx.moveTo(0, 120); magnifierCtx.lineTo(360, 120);
    magnifierCtx.stroke();
  }

  async function captureRegion() {
    removeOverlay();
    await sleep(100);

    const rx = Math.min(startX, endX);
    const ry = Math.min(startY, endY);
    const rw = Math.abs(endX - startX);
    const rh = Math.abs(endY - startY);
    const dpr = window.devicePixelRatio || 1;

    if (rw < 5 || rh < 5) return;

    _api.runtime.sendMessage({
      action: 'captureRegionAndOpen',
      crop: { x: rx, y: ry, w: rw, h: rh, dpr: dpr }
    });
  }

  // ─── Fragment / Element Mode ────────────────────────────────────────────
  function startFragmentMode() {
    if (overlay) removeOverlay();
    mode = 'fragment';

    fragmentHighlight = document.createElement('div');
    fragmentHighlight.id = 'capturex-fragment-highlight';
    document.body.appendChild(fragmentHighlight);

    const tip = document.createElement('div');
    tip.id = 'capturex-tip';
    tip.textContent = 'Hover over an element and click to capture it  •  ESC to cancel';
    document.body.appendChild(tip);

    document.addEventListener('mousemove', onFragmentMove, true);
    document.addEventListener('click', onFragmentClick, true);
    document.addEventListener('keydown', onFragmentKey);
  }

  function onFragmentMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === fragmentHighlight) return;
    lastHoveredEl = el;
    const rect = el.getBoundingClientRect();
    fragmentHighlight.style.left = rect.left + 'px';
    fragmentHighlight.style.top = rect.top + 'px';
    fragmentHighlight.style.width = rect.width + 'px';
    fragmentHighlight.style.height = rect.height + 'px';
  }

  function onFragmentClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!lastHoveredEl) return;
    captureElement(lastHoveredEl);
  }

  function onFragmentKey(e) {
    if (e.key === 'Escape') {
      document.removeEventListener('mousemove', onFragmentMove, true);
      document.removeEventListener('click', onFragmentClick, true);
      document.removeEventListener('keydown', onFragmentKey);
      fragmentHighlight?.remove();
      document.getElementById('capturex-tip')?.remove();
      mode = null;
    }
  }

  async function captureElement(el) {
    document.removeEventListener('mousemove', onFragmentMove, true);
    document.removeEventListener('click', onFragmentClick, true);
    document.removeEventListener('keydown', onFragmentKey);
    fragmentHighlight?.remove();
    document.getElementById('capturex-tip')?.remove();

    const rect = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    await sleep(100);
    _api.runtime.sendMessage({
      action: 'captureRegionAndOpen',
      crop: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        dpr: dpr
      }
    });
  }

  // ─── Delayed Capture / Countdown ───────────────────────────────────────
  function startCountdown(seconds) {
    const cd = document.createElement('div');
    cd.id = 'capturex-countdown';
    const num = document.createElement('div');
    num.id = 'capturex-countdown-num';
    num.textContent = seconds;
    cd.appendChild(num);
    document.body.appendChild(cd);

    let remaining = seconds;
    const interval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(interval);
        cd.remove();
        // Trigger visible capture
        _api.runtime.sendMessage({ action: 'captureTabScreenshot' }, async (res) => {
          const key = `capture_${Date.now()}`;
          await _api.storage.local.set({ [key]: { dataUrl: res.dataUrl, mode: 'visible', timestamp: Date.now() } });
          _api.runtime.sendMessage({ action: 'openEditor', dataKey: key });
        });
      } else {
        num.textContent = remaining;
        num.style.animation = 'none';
        num.offsetHeight; // reflow
        num.style.animation = 'capturex-pulse 1s ease-out';
      }
    }, 1000);
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────
  function removeOverlay() {
    overlay?.remove();
    overlay = null;
    document.getElementById('capturex-toolbar')?.remove();
    document.getElementById('capturex-tip')?.remove();
    document.removeEventListener('keydown', onKeyDown);
    mode = null;
    screenshotDataUrl = null;
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
})();
