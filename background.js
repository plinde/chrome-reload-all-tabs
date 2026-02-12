const DEFAULT_ROLLING_ENABLED = true;
const ROLLING_BATCH_SIZE = 1;
const ROLLING_COOLDOWN_SECONDS = 3;
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_COOLDOWN_SECONDS = 5;
const MIN_COOLDOWN_SECONDS = 5;
const DEFAULT_ACTION_TITLE = "Reload All Tabs";
const RUNNING_ACTION_TITLE = "Reloading tabs... click to cancel";
const CANCELLING_ACTION_TITLE = "Cancelling reload...";
const SPINNER_FRAMES = ["|", "/", "-", "\\"];
const SPINNER_INTERVAL_MS = 200;

const reloadState = {
  activeRun: null,
  spinnerTimer: null,
  spinnerFrameIndex: 0,
};

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
    return {
      rollingEnabled: true,
      batchSize: ROLLING_BATCH_SIZE,
      cooldownSeconds: ROLLING_COOLDOWN_SECONDS,
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

function createRunState() {
  let resolveCancel;
  const cancelPromise = new Promise((resolve) => {
    resolveCancel = resolve;
  });

  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    cancelRequested: false,
    cancelPromise,
    resolveCancel,
  };
}

function setIdleActionUi() {
  chrome.action.setTitle({ title: DEFAULT_ACTION_TITLE });
  chrome.action.setBadgeText({ text: "" });
  chrome.action.setBadgeBackgroundColor({ color: "#0b8043" });
}

function startRunningActionUi() {
  chrome.action.setTitle({ title: RUNNING_ACTION_TITLE });
  chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  chrome.action.setBadgeText({ text: SPINNER_FRAMES[0] });

  reloadState.spinnerFrameIndex = 0;
  reloadState.spinnerTimer = setInterval(() => {
    if (!reloadState.activeRun) {
      return;
    }
    reloadState.spinnerFrameIndex =
      (reloadState.spinnerFrameIndex + 1) % SPINNER_FRAMES.length;
    chrome.action.setBadgeText({
      text: SPINNER_FRAMES[reloadState.spinnerFrameIndex],
    });
  }, SPINNER_INTERVAL_MS);
}

function stopRunningActionUi() {
  if (reloadState.spinnerTimer) {
    clearInterval(reloadState.spinnerTimer);
    reloadState.spinnerTimer = null;
  }
  setIdleActionUi();
}

function requestCancellationForActiveRun() {
  const run = reloadState.activeRun;
  if (!run || run.cancelRequested) {
    return;
  }

  run.cancelRequested = true;
  run.resolveCancel();
  chrome.action.setTitle({ title: CANCELLING_ACTION_TITLE });
  chrome.action.setBadgeText({ text: "X" });
}

async function sleepOrCancel(run, ms) {
  const outcome = await Promise.race([
    sleep(ms).then(() => "sleep-finished"),
    run.cancelPromise.then(() => "cancelled"),
  ]);
  return outcome === "sleep-finished";
}

// Reload all tabs in current window using configured rolling behavior.
async function runReloadSequence(run) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const settings = await getReloadSettings();
  const orderedTabs = settings.rollingEnabled ? orderTabsForRolling(tabs) : tabs;
  const batches = chunk(orderedTabs, settings.batchSize);
  const delayMs = settings.cooldownSeconds * 1000;

  for (let i = 0; i < batches.length; i++) {
    if (run.cancelRequested) {
      return;
    }

    for (const t of batches[i]) {
      if (run.cancelRequested) {
        return;
      }
      if (typeof t.id === "number") {
        chrome.tabs.reload(t.id);
      }
    }

    if (i < batches.length - 1) {
      const completedSleep = await sleepOrCancel(run, delayMs);
      if (!completedSleep) {
        return;
      }
    }
  }
}

async function startReloadRun() {
  if (reloadState.activeRun) {
    return;
  }

  const run = createRunState();
  reloadState.activeRun = run;
  startRunningActionUi();

  try {
    await runReloadSequence(run);
  } catch (error) {
    console.error("Reload run failed", error);
  } finally {
    if (reloadState.activeRun && reloadState.activeRun.id === run.id) {
      reloadState.activeRun = null;
      stopRunningActionUi();
    }
  }
}

function toggleReload() {
  if (reloadState.activeRun) {
    requestCancellationForActiveRun();
    return;
  }

  void startReloadRun();
}

setIdleActionUi();

// Trigger on extension icon click
chrome.action.onClicked.addListener(toggleReload);

// Trigger on keyboard shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command === "reload-all-tabs") {
    toggleReload();
  }
});
