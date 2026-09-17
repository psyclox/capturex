// CaptureX - Chrome Background Service Worker (MV3)
// Handles: capture commands, full-page stitching, messaging router

const EDITOR_URL = chrome.runtime.getURL('editor/editor.html');

let fullPageStopRequested = false;
let isCapturingFullPage = false;
let fpCurrentRow = 0;
let fpTotalRows = 0;

// ─── Message Router ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'captureVisible') {
    handleVisibleCapture(msg, sender).then(sendResponse);
    return true;
  }
  if (msg.action === 'captureFullPage') {
    handleFullPageCapture(msg, sender).then(sendResponse);
    return true;
  }
  if (msg.action === 'stopFullPageCapture') {
    fullPageStopRequested = true;
    sendResponse({ success: true });
    return true;
  }
  if (msg.action === 'getFullPageStatus') {
    sendResponse({
      isCapturing: isCapturingFullPage,
      current: fpCurrentRow,
      total: fpTotalRows
    });
    return true;
  }
  if (msg.action === 'captureRegionAndOpen') {
    handleRegionCapture(msg.crop, sender).then(sendResponse);
    return true;
  }
  if (msg.action === 'openEditor') {
    openEditor(msg.dataKey).then(sendResponse);
    return true;
  }
  if (msg.action === 'captureTabScreenshot') {
    chrome.tabs.captureVisibleTab(null, { format: 'png', quality: 100 }, (dataUrl) => {
      sendResponse({ dataUrl });
    });
    return true;
  }
});

// ─── Visible Area Capture ──────────────────────────────────────────────────
async function handleVisibleCapture(msg, sender) {
  try {
    const tabId = sender.tab ? sender.tab.id : (await getActiveTab()).id;
    const dataUrl = await captureTab(tabId);
    const key = `capture_${Date.now()}`;
    await chrome.storage.local.set({ [key]: { dataUrl, mode: 'visible', timestamp: Date.now() } });
    await openEditor(key);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── Region & Element Capture ──────────────────────────────────────────────
async function handleRegionCapture(crop, sender) {
  try {
    const tabId = sender.tab ? sender.tab.id : (await getActiveTab()).id;
    const dataUrl = await captureTab(tabId);
    const key = `capture_${Date.now()}`;
    await chrome.storage.local.set({ [key]: { dataUrl, crop, mode: 'region', timestamp: Date.now() } });
    await openEditor(key);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── Full Page Capture via Stitching ──────────────────────────────────────
async function handleFullPageCapture(msg, sender) {
  let activeTabId = null;
  fullPageStopRequested = false;
  isCapturingFullPage = true;
  fpCurrentRow = 0;
  fpTotalRows = 0;

  try {
    const tab = await getActiveTab();
    activeTabId = tab.id;

    // Load user settings
    const settings = await chrome.storage.local.get(['prefMaxScreens', 'prefScrollSpeed', 'prefHideHeaders']);
    const maxScreens = parseInt(settings.prefMaxScreens) || 30;
    const scrollWait = parseInt(settings.prefScrollSpeed) || 400;
    const hideHeaders = settings.prefHideHeaders !== 'false';

    // Get page dimensions + devicePixelRatio
    const [{ result: dims }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        scrollW: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, window.innerWidth),
        scrollH: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, window.innerHeight),
        viewW:   window.innerWidth,
        viewH:   window.innerHeight,
        dpr:     window.devicePixelRatio || 1
      })
    });

    const { scrollW, scrollH, viewW, viewH, dpr } = dims;

    // Save original scroll position
    const [{ result: origScroll }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ x: window.scrollX, y: window.scrollY })
    });

    // Inject Stop button badge onto the page
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const old = document.getElementById('capturex-fp-badge');
        if (old) old.remove();
        const badge = document.createElement('div');
        badge.id = 'capturex-fp-badge';
        badge.innerHTML = `
          <div style="position:fixed; top:20px; right:20px; z-index:2147483647; background:#181c2a; color:#fff; border:1px solid #4f8ef7; border-radius:10px; padding:10px 16px; display:flex; align-items:center; gap:12px; box-shadow:0 8px 30px rgba(0,0,0,0.6); font-family:Inter,sans-serif; font-size:13px; font-weight:600; pointer-events:all;">
            <span style="display:inline-block; width:10px; height:10px; background:#2ecc71; border-radius:50%;"></span>
            <span id="capturex-fp-text">Capturing Page... (1)</span>
            <button id="capturex-fp-stop-btn" style="all:unset; background:#e74c3c; color:#fff; border-radius:6px; padding:5px 12px; font-size:12px; font-weight:700; cursor:pointer;">⏹ Stop & Capture</button>
          </div>
        `;
        document.body.appendChild(badge);
        document.getElementById('capturex-fp-stop-btn').addEventListener('click', () => {
          chrome.runtime.sendMessage({ action: 'stopFullPageCapture' });
        });
      }
    }).catch(() => {});

    // Scroll to top first
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.scrollTo({ left: 0, top: 0, behavior: 'instant' })
    });
    await sleep(350);

    const tiles = [];
    const rows = Math.min(maxScreens, Math.ceil(scrollH / viewH));
    const cols = Math.ceil(scrollW / viewW);
    fpTotalRows = rows;

    for (let row = 0; row < rows; row++) {
      if (fullPageStopRequested) break;
      fpCurrentRow = row + 1;

      // Broadcast progress to popup if open
      chrome.runtime.sendMessage({ action: 'fpProgress', current: row + 1, total: rows }).catch(() => {});

      // Update badge on page
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (r, total) => {
          const t = document.getElementById('capturex-fp-text');
          if (t) t.textContent = `Capturing Page... (${r} of ${total})`;
        },
        args: [row + 1, rows]
      }).catch(() => {});

      // If we are past row 0, hide fixed and sticky elements
      if (row > 0 && hideHeaders) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            document.querySelectorAll('*').forEach(el => {
              try {
                if (el.id === 'capturex-fp-badge' || el.closest('#capturex-fp-badge')) return;
                const style = window.getComputedStyle(el);
                if (style.position === 'fixed' || style.position === 'sticky') {
                  if (!el.hasAttribute('data-capturex-prev-vis')) {
                    el.setAttribute('data-capturex-prev-vis', el.style.visibility || '');
                    el.style.visibility = 'hidden';
                  }
                }
              } catch (_) {}
            });
          }
        });
      }

      for (let col = 0; col < cols; col++) {
        if (fullPageStopRequested) break;

        const targetX = col * viewW;
        const targetY = row * viewH;

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (x, y) => window.scrollTo({ left: x, top: y, behavior: 'instant' }),
          args: [targetX, targetY]
        });

        await sleep(scrollWait);

        const [{ result: actualScroll }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({ x: window.scrollX, y: window.scrollY })
        });

        const tileDataUrl = await captureTab(tab.id);
        tiles.push({
          dataUrl: tileDataUrl,
          scrollX: actualScroll.x,
          scrollY: actualScroll.y,
          viewW,
          viewH
        });
      }
    }

    // Remove stop button badge from page
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        document.getElementById('capturex-fp-badge')?.remove();
      }
    }).catch(() => {});

    // Restore fixed and sticky elements
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        document.querySelectorAll('[data-capturex-prev-vis]').forEach(el => {
          try {
            el.style.visibility = el.getAttribute('data-capturex-prev-vis');
            el.removeAttribute('data-capturex-prev-vis');
          } catch (_) {}
        });
      }
    });

    // Restore original scroll
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (x, y) => window.scrollTo({ left: x, top: y, behavior: 'instant' }),
      args: [origScroll.x, origScroll.y]
    });

    if (!tiles.length) return { success: false, error: 'No tiles captured' };

    // Calculate actual stitched height based on captured tiles
    const maxCapturedY = Math.max(...tiles.map(t => t.scrollY + t.viewH));
    const finalTotalH = Math.min(scrollH, maxCapturedY);

    const key = `capture_${Date.now()}`;
    await chrome.storage.local.set({
      [key]: {
        tiles,
        totalW: scrollW,
        totalH: finalTotalH,
        viewW,
        viewH,
        dpr,
        mode: 'fullpage',
        timestamp: Date.now()
      }
    });

    await openEditor(key);
    return { success: true };
  } catch (e) {
    if (activeTabId) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          func: () => {
            document.getElementById('capturex-fp-badge')?.remove();
            document.querySelectorAll('[data-capturex-prev-vis]').forEach(el => {
              try {
                el.style.visibility = el.getAttribute('data-capturex-prev-vis');
                el.removeAttribute('data-capturex-prev-vis');
              } catch (_) {}
            });
          }
        });
      } catch (_) {}
    }
    return { success: false, error: e.message };
  } finally {
    isCapturingFullPage = false;
    fullPageStopRequested = false;
    fpCurrentRow = 0;
    fpTotalRows = 0;
  }
}

// ─── Open Editor Tab ───────────────────────────────────────────────────────
async function openEditor(dataKey) {
  const url = `${EDITOR_URL}?key=${dataKey}`;
  await chrome.tabs.create({ url, active: true });
  return { success: true };
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function captureTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(null, { format: 'png', quality: 100 }, (dataUrl) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(dataUrl);
    });
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Context Menu ─────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus?.create?.({ id: 'capturex-region',   title: 'CaptureX: Capture Region',          contexts: ['page','image','link'] });
  chrome.contextMenus?.create?.({ id: 'capturex-fullpage', title: 'CaptureX: Full Page Screenshot',     contexts: ['page'] });
  chrome.contextMenus?.create?.({ id: 'capturex-visible',  title: 'CaptureX: Visible Area Screenshot',  contexts: ['page'] });
});

chrome.contextMenus?.onClicked?.addListener(async (info, tab) => {
  if (info.menuItemId === 'capturex-region') {
    await chrome.tabs.sendMessage(tab.id, { action: 'startRegionSelect' });
  } else if (info.menuItemId === 'capturex-fullpage') {
    await handleFullPageCapture({}, { tab });
  } else if (info.menuItemId === 'capturex-visible') {
    const dataUrl = await captureTab(tab.id);
    const key = `capture_${Date.now()}`;
    await chrome.storage.local.set({ [key]: { dataUrl, mode: 'visible', timestamp: Date.now() } });
    await openEditor(key);
  }
});
