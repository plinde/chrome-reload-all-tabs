# Tab Roller (working title) / Reload All Tabs

Reload All Tabs is a minimal Chrome Manifest V3 extension that refreshes all tabs in the current window from a toolbar click or keyboard shortcut.

## Working title

**Tab Roller** is the informal working title used across project docs.
The extension's current Chrome listing name remains **Reload All Tabs**.

## What It Does

- Reloads tabs in the current window only.
- Defaults to rolling mode via checkbox setting (enabled by default).
- Supports configurable batching: `n` tabs per batch.
- Waits a configurable cooldown between batches.
- In rolling mode, behavior is locked to `1` tab per batch with `3s` cooloff.
- Outside rolling mode, cooldown minimum is `5` seconds.
- Supports keyboard shortcut trigger:
  - Mac: `Command+Shift+E`
  - Windows/Linux: `Ctrl+Shift+E`

## Reload Behavior

When rolling mode is enabled, the extension:

1. Reloads the currently active tab first.
2. Continues reloading tabs serially from left to right in the tab strip.
3. Uses a fixed cooloff of 3 seconds between reloads.

When rolling mode is disabled, the extension:

1. Queries tabs in the active browser window.
2. Splits tabs into batches based on **Tabs at a time**.
3. Reloads each batch.
4. Waits **Cooldown (seconds)** before the next batch.

### Examples

- `Rolling enabled`:
  - Active tab first, then left-to-right rolling reload, 1 tab at a time every 3 seconds.
- `Tabs at a time = 4`, `Cooldown = 8`:
  - Four tabs reload together, then wait 8 seconds before the next four.

## Installation

### Load from source

1. Clone this repository.
2. Open `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this project directory.

## Configuration

### Extension options

1. Open `chrome://extensions/`.
2. Find **Reload All Tabs** and click **Details**.
3. Click **Extension options**.
4. Set:
   - **Enable rolling mode** (default on; locks to 1 tab and 3s cooloff)
   - **Tabs at a time** (used when rolling mode is off)
   - **Cooldown (seconds)** (used when rolling mode is off; minimum `5`)

### Keyboard shortcut

1. Open `chrome://extensions/shortcuts`.
2. Find **Reload All Tabs**.
3. Set your preferred key combination.

## Permissions

- `tabs`: needed to enumerate and reload tabs in the current window.
- `storage`: needed to persist reload settings (`rollingEnabled`, `batchSize`, `cooldownSeconds`) across sessions/devices.

## Project Structure

- `manifest.json`: extension manifest and capability declarations.
- `background.js`: MV3 service worker handling icon click, command trigger, and reload orchestration.
- `options.html`: options page UI.
- `options.js`: options page logic and settings persistence.
- `icons/`: extension icons.

## Development Notes

- This is a Manifest V3 service worker extension (no persistent background page).
- After changing `background.js`, `manifest.json`, or options files, reload the extension in `chrome://extensions/`.
- The service worker is event-driven and may stop when idle; avoid in-memory state assumptions.

## Why This Exists

Chrome does not provide a built-in global "reload all tabs in current window" action with customizable pacing. This extension turns that into one click or one shortcut, with safer rolling/batched behavior for large tab sets.

## License

MIT
