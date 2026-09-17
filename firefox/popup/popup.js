// CaptureX Popup Script

const isFirefox = typeof browser !== 'undefined';
const api = isFirefox ? browser : chrome;

let selectedDelay = 3;
let fpPollTimer = null;

// ─── Check on startup if full-page capture is running & poll ──────────────
function checkFpStatus() {
  try {
    api.runtime.sendMessage({ action: 'getFullPageStatus' }, (res) => {
      if (res && res.isCapturing) {
        showFullPageProgress(res.current, res.total);
        if (!fpPollTimer) {
          fpPollTimer = setInterval(checkFpStatus, 350);
        }
      } else {
        if (fpPollTimer) {
          clearInterval(fpPollTimer);
          fpPollTimer = null;
        }
      }
    });
  } catch (_) {}
}

checkFpStatus();

// Listen for live full-page capture progress broadcast
api.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'fpProgress') {
    showFullPageProgress(msg.current, msg.total);
  }
});

function showFullPageProgress(current, total) {
  const card = document.getElementById('fullpage-progress-card');
  const status = document.getElementById('fp-progress-status');
  if (card) card.style.display = 'flex';
  if (status) {
    if (current && total) {
      status.textContent = `Captured tile ${current} of ${total}…`;
    } else {
      status.textContent = `Scrolling and capturing tiles…`;
    }
  }
  const modes = document.getElementById('section-modes');
  if (modes) {
    modes.style.opacity = '0.4';
    modes.style.pointerEvents = 'none';
  }
}

// Stop Full Page capture from popup
const stopBtn = document.getElementById('btn-popup-stop-fp');
if (stopBtn) {
  stopBtn.addEventListener('click', async () => {
    try {
      await api.runtime.sendMessage({ action: 'stopFullPageCapture' });
      const status = document.getElementById('fp-progress-status');
      if (status) status.textContent = 'Stopping and stitching capture…';
      showStatus('Stopping capture & saving…');
    } catch (e) {
      showStatus('Error stopping capture: ' + e.message, true);
    }
  });
}

// ─── Delay selection ──────────────────────────────────────────────────────
document.querySelectorAll('.delay-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.delay-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedDelay = parseInt(btn.dataset.delay);
  });
});

// Set default active delay
const defaultDelay = document.querySelector('[data-delay="3"]');
if (defaultDelay) defaultDelay.classList.add('active');

// ─── Toggle switches ──────────────────────────────────────────────────────
document.querySelectorAll('.toggle').forEach(toggle => {
  toggle.addEventListener('click', () => {
    toggle.classList.toggle('active');
  });
});

// ─── Capture Buttons ──────────────────────────────────────────────────────
document.querySelectorAll('.capture-btn[data-mode]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const mode = btn.dataset.mode;
    btn.classList.add('loading');
    btn.innerHTML = `<div class="spinner"></div><span class="btn-label">Working…</span>`;

    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      if (mode === 'visible') {
        await api.runtime.sendMessage({ action: 'captureVisible' });
        window.close();
      } else if (mode === 'fullpage') {
        showFullPageProgress();
        showStatus('Capturing full page… Click Stop anytime');
        checkFpStatus();
        await api.runtime.sendMessage({ action: 'captureFullPage' });
        window.close();
      } else if (mode === 'region') {
        await api.tabs.sendMessage(tab.id, { action: 'startRegionSelect' });
        window.close();
      } else if (mode === 'fragment') {
        await api.tabs.sendMessage(tab.id, { action: 'startFragmentSelect' });
        window.close();
      }
    } catch (e) {
      showStatus('Error: ' + e.message, true);
      btn.classList.remove('loading');
      location.reload();
    }
  });
});

// ─── Delayed Capture ──────────────────────────────────────────────────────
const delayedBtn = document.getElementById('btn-delayed');
if (delayedBtn) {
  delayedBtn.addEventListener('click', async () => {
    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      await api.tabs.sendMessage(tab.id, { action: 'startDelayedCapture', delay: selectedDelay });
      window.close();
    } catch (e) {
      showStatus('Cannot inject on this page', true);
    }
  });
}

// ─── Shortcuts Modal ──────────────────────────────────────────────────────
const shortcutHint = document.getElementById('shortcut-hint');
if (shortcutHint) {
  shortcutHint.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('shortcuts-modal').style.display = 'flex';
  });
}

const modalClose = document.getElementById('modal-close');
if (modalClose) {
  modalClose.addEventListener('click', () => {
    document.getElementById('shortcuts-modal').style.display = 'none';
  });
}

document.getElementById('shortcuts-modal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
});

// ─── Settings Modal & Links ───────────────────────────────────────────────
const btnSettings = document.getElementById('btn-settings');
const settingsModal = document.getElementById('settings-modal');
const settingsClose = document.getElementById('settings-close');

if (btnSettings && settingsModal) {
  btnSettings.addEventListener('click', () => {
    settingsModal.style.display = 'flex';
  });
}

if (settingsClose && settingsModal) {
  settingsClose.addEventListener('click', () => {
    settingsModal.style.display = 'none';
  });
}

settingsModal?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
});

// Handle External Links in Settings (GitHub, LinkedIn, BuyMeACoffee, PayPal)
document.querySelectorAll('.social-btn, .donate-btn').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const url = link.getAttribute('href');
    if (url) {
      api.tabs.create({ url });
    }
  });
});

// ─── Load & Save Preferences ───────────────────────────────────────────────
const settingFormat = document.getElementById('setting-format');
const settingQuality = document.getElementById('setting-quality');
const settingAction = document.getElementById('setting-action');
const settingClipboard = document.getElementById('setting-clipboard');
const settingMaxScreens = document.getElementById('setting-max-screens');
const settingScrollSpeed = document.getElementById('setting-scroll-speed');
const settingHideHeaders = document.getElementById('setting-hide-headers');
const settingFilename = document.getElementById('setting-filename');

const prefKeys = [
  'prefFormat', 'prefQuality', 'prefAction', 'prefClipboard',
  'prefMaxScreens', 'prefScrollSpeed', 'prefHideHeaders', 'prefFilename'
];

if (api.storage && api.storage.local) {
  api.storage.local.get(prefKeys, (data) => {
    if (data.prefFormat && settingFormat) settingFormat.value = data.prefFormat;
    if (data.prefQuality && settingQuality) settingQuality.value = data.prefQuality;
    if (data.prefAction && settingAction) settingAction.value = data.prefAction;
    if (data.prefClipboard && settingClipboard) settingClipboard.value = data.prefClipboard;
    if (data.prefMaxScreens && settingMaxScreens) settingMaxScreens.value = data.prefMaxScreens;
    if (data.prefScrollSpeed && settingScrollSpeed) settingScrollSpeed.value = data.prefScrollSpeed;
    if (data.prefHideHeaders && settingHideHeaders) settingHideHeaders.value = data.prefHideHeaders;
    if (data.prefFilename && settingFilename) settingFilename.value = data.prefFilename;
  });

  settingFormat?.addEventListener('change', () => {
    api.storage.local.set({ prefFormat: settingFormat.value });
    showStatus('Format saved');
  });

  settingQuality?.addEventListener('change', () => {
    api.storage.local.set({ prefQuality: settingQuality.value });
    showStatus('Quality saved');
  });

  settingAction?.addEventListener('change', () => {
    api.storage.local.set({ prefAction: settingAction.value });
    showStatus('Action preference saved');
  });

  settingClipboard?.addEventListener('change', () => {
    api.storage.local.set({ prefClipboard: settingClipboard.value });
    showStatus('Clipboard preference saved');
  });

  settingMaxScreens?.addEventListener('change', () => {
    api.storage.local.set({ prefMaxScreens: settingMaxScreens.value });
    showStatus('Max screens saved');
  });

  settingScrollSpeed?.addEventListener('change', () => {
    api.storage.local.set({ prefScrollSpeed: settingScrollSpeed.value });
    showStatus('Scroll speed saved');
  });

  settingHideHeaders?.addEventListener('change', () => {
    api.storage.local.set({ prefHideHeaders: settingHideHeaders.value });
    showStatus('Header preference saved');
  });

  settingFilename?.addEventListener('change', () => {
    api.storage.local.set({ prefFilename: settingFilename.value });
    showStatus('Filename prefix saved');
  });
}

// ─── Status message helper ────────────────────────────────────────────────
function showStatus(msg, isError = false) {
  const el = document.createElement('div');
  el.className = 'status-msg';
  el.textContent = msg;
  if (isError) el.style.cssText += '; background:rgba(255,80,80,0.15); border-color:rgba(255,80,80,0.4); color:#ff6060;';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
