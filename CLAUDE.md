# CLAUDE.md

Chrome Manifest V3 extension that reloads all tabs in the current window.

## Key Details

**Files**: `background.js` (service worker), `manifest.json`, `icons/`

**Trigger**: Toolbar icon or keyboard shortcut (`Cmd+Shift+E` Mac, `Ctrl+Shift+E` Windows/Linux)

**Throttling**: Windows with >20 tabs reload in batches of 5 with 5-second delays. Configurable via constants at top of `background.js`.

**Scope**: `chrome.tabs.query({ windowId })` - reloads the window where the click/shortcut originated, not all browser windows.

**Concurrency**: Run state lives in `runsByWindowId` (`Map` keyed by `windowId`), so windows reload independently. All badge/title writes pass `tabId` — never window-global — so one window's spinner cannot paint over another's. One shared keep-alive timer is held while any run is in flight (`acquireKeepAlive`/`releaseKeepAlive`).

## Development

Load unpacked: `chrome://extensions/` → Developer mode → Load unpacked

Test changes: Reload extension on `chrome://extensions/` (no browser restart needed)

Icons: `icons/*.png` are generated from `icons/icon.svg` via
`for s in 16 32 48 128; do rsvg-convert -w $s -h $s icons/icon.svg -o icons/icon$s.png; done`

Version: `1.4.0` in `manifest.json` (use semver)
