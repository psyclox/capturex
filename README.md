# CaptureX Browser Extension

<div align="center">
  <img src="https://raw.githubusercontent.com/psyclox/psyclox-assets/main/doc/icon/icon-512.png" width="96" alt="CaptureX" />
  <h1>CaptureX v1.4</h1>
  <p>All-in-one screenshot & annotation tool for Chrome and Firefox</p>
</div>

---

## ✨ Features

### Capture Modes
| Mode | Description | Shortcut |
|------|-------------|----------|
| **Region Select** | Drag to select any area with live zoom magnifier | Alt+Shift+S |
| **Visible Area** | Capture the current viewport | Alt+Shift+V |
| **Full Page** | Capture entire scrollable page (stitched) | Alt+Shift+F |
| **Fragment/Element** | Hover to highlight an element and click to capture | Alt+Shift+E |
| **Delayed Capture** | 3s / 5s / 10s timer countdown | — |

### Annotation Tools
| Tool | Key | Description |
|------|-----|-------------|
| Select | V | Move / interact |
| Pen | P | Smooth freehand drawing (Catmull-Rom splines) |
| Highlighter | H | Semi-transparent highlight brush |
| Rectangle | R | Filled or outlined rectangle |
| Ellipse | E | Filled or outlined ellipse/circle |
| Arrow | A | 5 styles: solid, double, curved, line, dashed |
| Text | T | 9 Google Fonts, custom size |
| Counter | — | Auto-numbered step labels |
| Blur (Rect) | B | Pixelated blur over a selected region |
| Blur (Brush) | — | Circular brush blur |
| Eraser | Del | Erase annotation layer |
| Crop | C | Crop canvas with resize handles |
| Image Insert | — | Insert local image with 8-handle resize |

### Style Controls
- **Stroke color** + opacity slider
- **Fill color** + opacity slider
- **Stroke width** (1–30px)
- **Arrow style** selector dropdown
- **Blur level** (1–20) + **brush size** (5–150px)
- **9 Fonts**: Arial, Times New Roman, Courier New, Bad Script, Lobster, Marck Script, Poiret One, RobotoSlab, Russo One

### Export
| Format | Options |
|--------|---------|
| **PNG** | Full quality instant download |
| **PDF — Single Page** | Entire capture on one auto-sized page |
| **PDF — Multi Page** | Splits into A4 / A3 / Letter / Legal pages |

---

## 📁 Project Structure

```
capturex/
├── assets/          ← Shared icons (16, 32, 48, 128, 512px)
├── chrome/          ← Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js  (Service Worker)
│   ├── content.js     (Region/Fragment selector)
│   ├── content.css
│   ├── popup/         (Extension popup)
│   ├── editor/        (Full annotation editor)
│   ├── libs/          (jsPDF bundled)
│   └── icons/
├── firefox/         ← Firefox Extension (Manifest V2)
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── content.css
│   ├── popup/
│   ├── editor/
│   ├── libs/
│   └── icons/
└── build/           ← Build scripts + output ZIPs
    ├── build-chrome.ps1
    └── build-firefox.ps1
```

---

## 🚀 Local Testing

### Chrome
1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `chrome/` folder
5. Click the CaptureX icon in your toolbar

### Firefox
1. Open `about:debugging`
2. Click **This Firefox**
3. Click **Load Temporary Add-on...**
4. Select `firefox/manifest.json`

---

## 📦 Building for Distribution

### Chrome (.zip for Web Store)
```powershell
cd build
.\build-chrome.ps1 -Version "1.0.0"
```
Then upload `build/capturex-chrome-v1.4.zip` to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/developer/dashboard).

**To create .crx:**
1. Go to `chrome://extensions`
2. Enable Developer mode
3. Click "Pack extension" → select `chrome/` folder
4. Chrome outputs a `.crx` and `.pem` key — **keep the .pem safe!**

### Firefox (.xpi for AMO)
```powershell
cd build
.\build-firefox.ps1 -Version "1.0.0"
```
Then upload `build/capturex-firefox-v1.4.xpi` to [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/).

**To sign with web-ext:**
```powershell
.\build-firefox.ps1 -Version "1.0.0" -JwtIssuer "your-jwt-issuer" -JwtSecret "your-jwt-secret"
```

---

## ⌨ Keyboard Shortcuts (Editor)

| Action | Shortcut |
|--------|----------|
| Undo | Ctrl+Z |
| Redo | Ctrl+Y |
| Save PNG | Ctrl+S |
| Zoom In | + |
| Zoom Out | - |
| Reset Zoom | 0 |
| Fit to Screen | (fit button) |
| Escape | ESC |

---

## 🛠 Technical Details

- **Chrome**: Manifest V3 + Service Worker background
- **Firefox**: Manifest V2 + Event Page (persistent: false)
- **Pen drawing**: Catmull-Rom spline interpolation for smooth, assisted strokes
- **Blur**: Pixelate + box-blur (Gaussian approximation) — no server needed
- **Full-page capture**: Tile-based scrolling stitcher
- **PDF**: jsPDF bundled locally (no CDN — works offline, passes store review)
- **Zero external runtime dependencies** — everything bundled

---

## 📋 Permissions

| Permission | Reason |
|-----------|---------|
| `activeTab` | Access current tab for capture |
| `tabs` | Open editor tab |
| `scripting` (Chrome) | Inject content scripts on-demand |
| `storage` | Pass screenshot data to editor |
| `downloads` | Save PNG/PDF files |
| `<all_urls>` | Full-page capture on any website |

---

<div align="center">
  <b>CaptureX v1.4</b> — Built with ❤ using vanilla JS + Canvas API
</div>

