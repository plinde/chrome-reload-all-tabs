const DEFAULT_ROLLING_ENABLED = true;
const ROLLING_BATCH_SIZE = 1;
const ROLLING_COOLDOWN_SECONDS = 3;
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_COOLDOWN_SECONDS = 5;
const MIN_COOLDOWN_SECONDS = 5;

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

// Reload all tabs in current window using configured rolling behavior.
async function reloadAllTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const settings = await getReloadSettings();
  const orderedTabs = settings.rollingEnabled ? orderTabsForRolling(tabs) : tabs;
  const batches = chunk(orderedTabs, settings.batchSize);
  const delayMs = settings.cooldownSeconds * 1000;
  for (let i = 0; i < batches.length; i++) {
    for (const t of batches[i]) {
      if (typeof t.id === "number") {
        chrome.tabs.reload(t.id);
      }
    }
    if (i < batches.length - 1) {
      await sleep(delayMs);
    }
  }
}

// Trigger on extension icon click
chrome.action.onClicked.addListener(reloadAllTabs);

// Trigger on keyboard shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command === 'reload-all-tabs') {
    reloadAllTabs();
  }
});
