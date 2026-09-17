// CaptureX — Firefox Background Script (Manifest V2)
// Uses browser.* WebExtensions API

const EDITOR_URL = browser.runtime.getURL('editor/editor.html');

let fullPageStopRequested = false;
let isCapturingFullPage = false;
let fpCurrentRow = 0;
let fpTotalRows = 0;

// ─── Message Router ──────────────────────────────────────────────────────
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'captureVisible') {
    handleVisibleCapture(sender).then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (msg.action === 'captureFullPage') {
    handleFullPageCapture(sender).then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
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
    handleRegionCapture(msg.crop, sender).then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (msg.action === 'openEditor') {
    openEditor(msg.dataKey).then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (msg.action === 'captureTabScreenshot') {
    const winId = sender.tab ? sender.tab.windowId : null;
    captureTab(winId)
      .then(dataUrl => sendResponse({ dataUrl }))
      .catch(err => sendResponse({ dataUrl: null, error: err.message }));
    return true;
  }
});

// ─── Safe Capture Tab Helper ──────────────────────────────────────────────
// In Firefox, passing `null` as windowId throws: "Type error for parameter windowId (Integer null is not valid)"
async function captureTab(windowId) {
  try {
    if (typeof windowId === 'number') {
      return await browser.tabs.captureVisibleTab(windowId, { format: 'png', quality: 100 });
    }
    return await browser.tabs.captureVisibleTab({ format: 'png', quality: 100 });
  } catch (e) {
    return await browser.tabs.captureVisibleTab();
  }
}

// ─── Visible Area Capture ─────────────────────────────────────────────────
async function handleVisibleCapture(sender) {
  try {
    const tab = (sender && sender.tab) ? sender.tab : await getActiveTab();
    if (!tab) return { success: false, error: 'No active tab found' };

    const dataUrl = await captureTab(tab.windowId);
    const key = `capture_${Date.now()}`;
    await browser.storage.local.set({ [key]: { dataUrl, mode: 'visible', timestamp: Date.now() } });
    await openEditor(key);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── Region & Element Capture ─────────────────────────────────────────────
async function handleRegionCapture(crop, sender) {
  try {
    const tab = (sender && sender.tab) ? sender.tab : await getActiveTab();
    if (!tab) return { success: false, error: 'No active tab found' };

    const dataUrl = await captureTab(tab.windowId);
    const key = `capture_${Date.now()}`;
    await browser.storage.local.set({ [key]: { dataUrl, crop, mode: 'region', timestamp: Date.now() } });
    await openEditor(key);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── Full Page Capture via Scrolling ──────────────────────────────────────
async function handleFullPageCapture(sender) {
  let tabId = null;
  fullPageStopRequested = false;
  isCapturingFullPage = true;
  fpCurrentRow = 0;
  fpTotalRows = 0;

  try {
    const tab = (sender && sender.tab) ? sender.tab : await getActiveTab();
    if (!tab) return { success: false, error: 'No active tab found' };
    tabId = tab.id;

    // Read user settings
    const settings = await browser.storage.local.get(['prefMaxScreens', 'prefScrollSpeed', 'prefHideHeaders']);
    const maxScreens = parseInt(settings.prefMaxScreens) || 30;
    const scrollWait = parseInt(settings.prefScrollSpeed) || 400;
    const hideHeaders = settings.prefHideHeaders !== 'false';

    // Query dimensions
    const dimsRes = await browser.tabs.executeScript(tabId, {
      code: `({
        scrollW: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, window.innerWidth),
        scrollH: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, window.innerHeight),
        viewW: window.innerWidth,
        viewH: window.innerHeight,
        dpr: window.devicePixelRatio || 1
      })`
    });

    if (!dimsRes || !dimsRes[0]) return { success: false, error: 'Cannot measure page dimensions' };
    const { scrollW, scrollH, viewW, viewH, dpr } = dimsRes[0];

    // Save original scroll
    const origScrollRes = await browser.tabs.executeScript(tabId, {
      code: `({ x: window.scrollX, y: window.scrollY })`
    });
    const origScroll = (origScrollRes && origScrollRes[0]) ? origScrollRes[0] : { x: 0, y: 0 };

    // Scroll to top
    await browser.tabs.executeScript(tabId, {
      code: `window.scrollTo({ left: 0, top: 0, behavior: 'instant' });`
    });
    await sleep(350);

    const rows = Math.min(maxScreens, Math.ceil(scrollH / viewH));
    const cols = Math.ceil(scrollW / viewW);
    fpTotalRows = rows;
    const tiles = [];

    for (let row = 0; row < rows; row++) {
      if (fullPageStopRequested) break;
      fpCurrentRow = row + 1;

      // Hide sticky/fixed elements after first row to prevent duplicated headers
      if (row > 0 && hideHeaders) {
        await browser.tabs.executeScript(tabId, {
          code: `
            document.querySelectorAll('*').forEach(function(el) {
              try {
                var style = window.getComputedStyle(el);
                if (style.position === 'fixed' || style.position === 'sticky') {
                  if (!el.hasAttribute('data-capturex-prev-vis')) {
                    el.setAttribute('data-capturex-prev-vis', el.style.visibility || '');
                    el.style.visibility = 'hidden';
                  }
                }
              } catch (_) {}
            });
          `
        }).catch(() => {});
      }

      for (let col = 0; col < cols; col++) {
        if (fullPageStopRequested) break;

        const targetX = col * viewW;
        const targetY = row * viewH;

        await browser.tabs.executeScript(tabId, {
          code: `window.scrollTo({ left: ${targetX}, top: ${targetY}, behavior: 'instant' });`
        });

        await sleep(scrollWait);

        const actualScrollRes = await browser.tabs.executeScript(tabId, {
          code: `({ x: window.scrollX, y: window.scrollY })`
        });
        const actualScroll = (actualScrollRes && actualScrollRes[0]) ? actualScrollRes[0] : { x: targetX, y: targetY };

        const tileDataUrl = await captureTab(tab.windowId);
        tiles.push({
          dataUrl: tileDataUrl,
          scrollX: actualScroll.x,
          scrollY: actualScroll.y,
          viewW,
          viewH
        });
      }
    }

    // Restore hidden fixed and sticky elements
    await browser.tabs.executeScript(tabId, {
      code: `
        document.querySelectorAll('[data-capturex-prev-vis]').forEach(function(el) {
          try {
            el.style.visibility = el.getAttribute('data-capturex-prev-vis');
            el.removeAttribute('data-capturex-prev-vis');
          } catch (_) {}
        });
      `
    }).catch(() => {});

    // Restore original scroll position
    await browser.tabs.executeScript(tabId, {
      code: `window.scrollTo({ left: ${origScroll.x}, top: ${origScroll.y}, behavior: 'instant' });`
    }).catch(() => {});

    if (!tiles.length) return { success: false, error: 'No tiles captured' };

    const maxCapturedY = Math.max(...tiles.map(t => t.scrollY + t.viewH));
    const finalTotalH = Math.min(scrollH, maxCapturedY);

    const key = `capture_${Date.now()}`;
    await browser.storage.local.set({
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

    isCapturingFullPage = false;
    await openEditor(key);
    return { success: true };
  } catch (e) {
    if (tabId) {
      try {
        await browser.tabs.executeScript(tabId, {
          code: `
            document.querySelectorAll('[data-capturex-prev-vis]').forEach(function(el) {
              try {
                el.style.visibility = el.getAttribute('data-capturex-prev-vis');
                el.removeAttribute('data-capturex-prev-vis');
              } catch (_) {}
            });
          `
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

// ─── Open Editor Tab ──────────────────────────────────────────────────────
async function openEditor(dataKey) {
  const url = `${EDITOR_URL}?key=${dataKey}`;
  await browser.tabs.create({ url, active: true });
  return { success: true };
}

// ─── Helpers ──────────────────────────────────────────────────────────────
async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs.length ? tabs[0] : null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Safe Context Menus ───────────────────────────────────────────────────
const menuApi = (typeof browser !== 'undefined' && (browser.menus || browser.contextMenus)) || (typeof chrome !== 'undefined' && chrome.contextMenus);

if (menuApi && menuApi.create) {
  try {
    menuApi.removeAll().then(() => {
      menuApi.create({ id: 'capturex-region', title: 'CaptureX: Capture Region', contexts: ['page', 'image'] }, () => {});
      menuApi.create({ id: 'capturex-fullpage', title: 'CaptureX: Full Page Screenshot', contexts: ['page'] }, () => {});
      menuApi.create({ id: 'capturex-visible', title: 'CaptureX: Visible Area', contexts: ['page'] }, () => {});
    }).catch(() => {});

    if (menuApi.onClicked) {
      menuApi.onClicked.addListener(async (info, tab) => {
        try {
          if (info.menuItemId === 'capturex-region') {
            await browser.tabs.sendMessage(tab.id, { action: 'startRegionSelect' });
          } else if (info.menuItemId === 'capturex-fullpage') {
            await handleFullPageCapture({ tab });
          } else if (info.menuItemId === 'capturex-visible') {
            const dataUrl = await captureTab(tab.windowId);
            const key = `capture_${Date.now()}`;
            await browser.storage.local.set({ [key]: { dataUrl, mode: 'visible', timestamp: Date.now() } });
            await openEditor(key);
          }
        } catch (_) {}
      });
    }
  } catch (_) {}
}
