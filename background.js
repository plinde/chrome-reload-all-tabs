const DEFAULT_ROLLING_ENABLED = true;
const DEFAULT_ROLLING_BATCH_SIZE = 1;
const MAX_ROLLING_BATCH_SIZE = 3;
const DEFAULT_ROLLING_COOLDOWN_SECONDS = 3;
const MIN_ROLLING_COOLDOWN_SECONDS = 3;
const MAX_COOLDOWN_SECONDS = 900;
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_COOLDOWN_SECONDS = 5;
const MIN_COOLDOWN_SECONDS = 5;
const DEFAULT_ACTION_TITLE = "Reload All Tabs";
const RUNNING_ACTION_TITLE = "Reloading tabs... click to cancel";
const CANCELLING_ACTION_TITLE = "Cancelling reload...";
const IDLE_BADGE_COLOR = "#6b7280";
const RUNNING_BADGE_COLOR = "#8a6d3b";
const SPINNER_FRAMES = ["|", "/", "-", "\\"];
const SPINNER_INTERVAL_MS = 200;
const KEEP_ALIVE_INTERVAL_MS = 20000;

// One run per browser window, keyed by windowId. Windows operate independently:
// starting, cancelling, and the action badge/title are all scoped to a single
// window, so two windows can reload concurrently without interfering.
const runsByWindowId = new Map();

// A single keep-alive timer is shared by all in-flight runs.
let keepAliveTimer = null;

// Helper: sleep for a given number of milliseconds
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper: split an array into sub-arrays of a given size
function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function toPositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  const rounded = Math.floor(numeric);
  return rounded > 0 ? rounded : fallback;
}

function normalizeSettings(rawSettings = {}) {
  const batchSize = toPositiveInteger(rawSettings.batchSize, DEFAULT_BATCH_SIZE);
  const cooldownSeconds = toPositiveInteger(
    rawSettings.cooldownSeconds,
    DEFAULT_COOLDOWN_SECONDS
  );
  const rollingEnabled =
    typeof rawSettings.rollingEnabled === "boolean"
      ? rawSettings.rollingEnabled
      : DEFAULT_ROLLING_ENABLED;

  if (rollingEnabled) {
    const rollingBatch = toPositiveInteger(rawSettings.batchSize, DEFAULT_ROLLING_BATCH_SIZE);
    const rollingCooldown = toPositiveInteger(
      rawSettings.cooldownSeconds,
      DEFAULT_ROLLING_COOLDOWN_SECONDS
    );
    return {
      rollingEnabled: true,
      batchSize: Math.min(rollingBatch, MAX_ROLLING_BATCH_SIZE),
      cooldownSeconds: Math.min(
        Math.max(rollingCooldown, MIN_ROLLING_COOLDOWN_SECONDS),
        MAX_COOLDOWN_SECONDS
      ),
    };
  }

  return {
    rollingEnabled: false,
    batchSize,
    cooldownSeconds: Math.max(cooldownSeconds, MIN_COOLDOWN_SECONDS),
  };
}

async function getReloadSettings() {
  const stored = await chrome.storage.sync.get([
    "rollingEnabled",
    "batchSize",
    "cooldownSeconds",
  ]);
  return normalizeSettings(stored);
}

function orderTabsForRolling(tabs) {
  const sortedTabs = [...tabs].sort((a, b) => a.index - b.index);
  const activeTab = sortedTabs.find((tab) => tab.active);
  if (!activeTab) {
    return sortedTabs;
  }

  return [activeTab, ...sortedTabs.filter((tab) => tab.id !== activeTab.id)];
}

function createRunState(windowId) {
  let resolveCancel;
  const cancelPromise = new Promise((resolve) => {
    resolveCancel = resolve;
  });

  return {
    windowId,
    cancelRequested: false,
    cancelPromise,
    resolveCancel,
    spinnerTimer: null,
    spinnerFrameIndex: 0,
    // Every tab this run has painted, so all of them can be reset when it ends.
    paintedTabIds: new Set(),
  };
}

// ---------------------------------------------------------------------------
// Action UI
//
// Title and badge are set per-tab so a run in one window never paints over
// another window's state.  Chrome keeps tab-scoped action state for the life of
// the tab (it resets only when the tab closes, not on navigation), so anything
// painted must be explicitly reset — see clearRunActionUi and resetTabActionUi.
// The badge is only visible on a window's active tab, so that is the only tab
// worth painting.
// ---------------------------------------------------------------------------

async function getActiveTabId(windowId) {
  try {
    const [tab] = await chrome.tabs.query({ windowId, active: true });
    return tab && typeof tab.id === "number" ? tab.id : null;
  } catch {
    return null;
  }
}

async function paintTab(tabId, title, badgeText, badgeColor) {
  if (tabId == null) {
    return;
  }

  try {
    await Promise.all([
      chrome.action.setTitle({ tabId, title }),
      chrome.action.setBadgeText({ tabId, text: badgeText }),
      chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor }),
    ]);
  } catch {
    // The tab went away mid-paint; nothing to do.
  }
}

// Drop a tab's own action state so it inherits the global idle values again.
// Passing `text: null` with a tabId is what clears tab-scoped badge text —
// an empty string would instead pin a tab-specific empty badge.
async function resetTabActionUi(tabId) {
  if (tabId == null) {
    return;
  }

  try {
    await Promise.all([
      chrome.action.setTitle({ tabId, title: DEFAULT_ACTION_TITLE }),
      chrome.action.setBadgeText({ tabId, text: null }),
    ]);
  } catch {
    // The tab went away; nothing to do.
  }
}

// Paint a run's current state onto one tab of its window.
function paintRunState(run, tabId) {
  if (tabId == null) {
    return Promise.resolve();
  }

  run.paintedTabIds.add(tabId);

  if (run.cancelRequested) {
    return paintTab(tabId, CANCELLING_ACTION_TITLE, "X", RUNNING_BADGE_COLOR);
  }

  return paintTab(
    tabId,
    RUNNING_ACTION_TITLE,
    SPINNER_FRAMES[run.spinnerFrameIndex],
    RUNNING_BADGE_COLOR
  );
}

function setGlobalIdleActionUi() {
  chrome.action.setTitle({ title: DEFAULT_ACTION_TITLE });
  chrome.action.setBadgeText({ text: "" });
  chrome.action.setBadgeBackgroundColor({ color: IDLE_BADGE_COLOR });
}

// Reset every tab this run painted.  Tab-scoped state outlives navigation, and
// tabs the user switched away from keep their badge until cleared, so clearing
// only the active tab would leave stale spinners behind.
async function clearRunActionUi(run) {
  const activeTabId = await getActiveTabId(run.windowId);

  // A new run may have started in this window while the query was in flight.
  // Clearing now would wipe its freshly painted spinner, so hand our painted
  // tabs over to it and let it do the cleanup when it finishes.
  const successor = runsByWindowId.get(run.windowId);
  if (successor) {
    for (const tabId of run.paintedTabIds) {
      successor.paintedTabIds.add(tabId);
    }
    run.paintedTabIds.clear();
    return;
  }

  if (activeTabId != null) {
    run.paintedTabIds.add(activeTabId);
  }

  await Promise.all([...run.paintedTabIds].map(resetTabActionUi));
  run.paintedTabIds.clear();
}

// The service worker can be terminated mid-run, which loses every run's
// in-memory paintedTabIds and strands tab-scoped badges (they survive until the
// tab closes).  No run can be in flight at startup, so any tab-scoped badge
// present now is stale — sweep them all.
async function clearStaleTabActionUi() {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.filter((tab) => typeof tab.id === "number").map((tab) => resetTabActionUi(tab.id))
    );
  } catch (error) {
    console.error("Failed to clear stale action state", error);
  }
}

async function repaintRunWindow(run) {
  const tabId = await getActiveTabId(run.windowId);
  // The run may have finished while the query was in flight.
  if (runsByWindowId.get(run.windowId) !== run) {
    return;
  }
  await paintRunState(run, tabId);
}

function startSpinner(run) {
  run.spinnerFrameIndex = 0;
  void repaintRunWindow(run);

  run.spinnerTimer = setInterval(() => {
    run.spinnerFrameIndex = (run.spinnerFrameIndex + 1) % SPINNER_FRAMES.length;
    void repaintRunWindow(run);
  }, SPINNER_INTERVAL_MS);
}

function stopSpinner(run) {
  if (run.spinnerTimer) {
    clearInterval(run.spinnerTimer);
    run.spinnerTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Keep-alive
//
// Periodically ping a Chrome API to prevent the service worker from being
// terminated mid-reload.  The MV3 idle timeout is ~30 s; pinging every 20 s
// keeps the worker alive for as long as any run is in flight.
// ---------------------------------------------------------------------------

function acquireKeepAlive() {
  if (keepAliveTimer) {
    return;
  }
  keepAliveTimer = setInterval(() => {
    chrome.runtime.getPlatformInfo();
  }, KEEP_ALIVE_INTERVAL_MS);
}

function releaseKeepAlive() {
  if (keepAliveTimer && runsByWindowId.size === 0) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

function requestCancellation(run) {
  if (run.cancelRequested) {
    return;
  }

  run.cancelRequested = true;
  run.resolveCancel();
  void repaintRunWindow(run);
}

async function sleepOrCancel(run, ms) {
  const outcome = await Promise.race([
    sleep(ms).then(() => "sleep-finished"),
    run.cancelPromise.then(() => "cancelled"),
  ]);
  return outcome === "sleep-finished";
}

// Reload all tabs in the run's window using configured rolling behavior.
async function runReloadSequence(run) {
  const tabs = await chrome.tabs.query({ windowId: run.windowId });
  const settings = await getReloadSettings();
  const orderedTabs = settings.rollingEnabled ? orderTabsForRolling(tabs) : tabs;
  const batches = chunk(orderedTabs, settings.batchSize);
  const delayMs = settings.cooldownSeconds * 1000;

  for (let i = 0; i < batches.length; i++) {
    if (run.cancelRequested) {
      return;
    }

    // A batch reloads simultaneously; a tab closed between query and reload
    // simply drops out.
    await Promise.all(
      batches[i]
        .filter((t) => typeof t.id === "number")
        .map((t) => chrome.tabs.reload(t.id).catch(() => {}))
    );

    if (i < batches.length - 1) {
      const completedSleep = await sleepOrCancel(run, delayMs);
      if (!completedSleep) {
        return;
      }
    }
  }
}

async function startReloadRun(windowId) {
  if (runsByWindowId.has(windowId)) {
    return;
  }

  const run = createRunState(windowId);
  runsByWindowId.set(windowId, run);
  acquireKeepAlive();
  startSpinner(run);

  try {
    await runReloadSequence(run);
  } catch (error) {
    console.error(`Reload run failed for window ${windowId}`, error);
  } finally {
    stopSpinner(run);
    if (runsByWindowId.get(windowId) === run) {
      runsByWindowId.delete(windowId);
    }
    // Clean up before dropping the keep-alive, so the worker cannot be
    // terminated part-way through resetting the badges.
    await clearRunActionUi(run);
    releaseKeepAlive();
  }
}

function toggleReload(windowId) {
  if (typeof windowId !== "number") {
    return;
  }

  const run = runsByWindowId.get(windowId);
  if (run) {
    requestCancellation(run);
    return;
  }

  void startReloadRun(windowId);
}

setGlobalIdleActionUi();
void clearStaleTabActionUi();

// Trigger on extension icon click — use the clicked tab's windowId to target
// the correct window (service workers have no "current window").
chrome.action.onClicked.addListener((tab) => {
  toggleReload(tab.windowId);
});

// Trigger on keyboard shortcut — the tab parameter is available since Chrome 101.
// Fall back to lastFocused if Chrome omits it.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "reload-all-tabs") {
    return;
  }

  if (tab && tab.windowId != null) {
    toggleReload(tab.windowId);
  } else {
    const win = await chrome.windows.getLastFocused();
    toggleReload(win.id);
  }
});

// Repaint immediately when the user switches tabs inside a running window so
// the spinner does not lag behind by up to one tick.
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  const run = runsByWindowId.get(windowId);
  if (run) {
    void paintRunState(run, tabId);
  }
});

// A tab dragged into another window adopts that window's state: it either joins
// the destination's run or drops the badge it carried over from its old window.
chrome.tabs.onAttached.addListener((tabId, { newWindowId }) => {
  const run = runsByWindowId.get(newWindowId);
  if (run) {
    void paintRunState(run, tabId);
  } else {
    void resetTabActionUi(tabId);
  }
});

// Abandon a run whose window has been closed.
chrome.windows.onRemoved.addListener((windowId) => {
  const run = runsByWindowId.get(windowId);
  if (run) {
    requestCancellation(run);
  }
});
