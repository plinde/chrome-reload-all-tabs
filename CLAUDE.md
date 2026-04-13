# CLAUDE.md

Chrome Manifest V3 extension that reloads all tabs in the current window.

## Key Details

**Files**: `background.js` (service worker), `manifest.json`, `icons/`

**Trigger**: Toolbar icon or keyboard shortcut (`Cmd+Shift+E` Mac, `Ctrl+Shift+E` Windows/Linux)

**Throttling**: Windows with >20 tabs reload in batches of 5 with 5-second delays. Configurable via constants at top of `background.js`.

**Scope**: `chrome.tabs.query({ windowId })` - reloads the window where the click/shortcut originated, not all browser windows.

## Development

Load unpacked: `chrome://extensions/` → Developer mode → Load unpacked

Test changes: Reload extension on `chrome://extensions/` (no browser restart needed)

Version: `1.3.2` in `manifest.json` (use semver)
