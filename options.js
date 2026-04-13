const DEFAULT_ROLLING_ENABLED = true;
const DEFAULT_ROLLING_BATCH_SIZE = 1;
const MAX_ROLLING_BATCH_SIZE = 3;
const DEFAULT_ROLLING_COOLDOWN_SECONDS = 3;
const MIN_ROLLING_COOLDOWN_SECONDS = 3;
const MAX_COOLDOWN_SECONDS = 900;
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_COOLDOWN_SECONDS = 5;
const MIN_COOLDOWN_SECONDS = 5;

const form = document.getElementById("settings-form");
const rollingEnabledInput = document.getElementById("rollingEnabled");
const batchSizeInput = document.getElementById("batchSize");
const batchSizeHint = document.getElementById("batchSizeHint");
const cooldownInput = document.getElementById("cooldownSeconds");
const cooldownHint = document.getElementById("cooldownHint");
const rollingHint = document.getElementById("rollingHint");
const statusEl = document.getElementById("status");

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

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b00020" : "";
}

function syncInputConstraints() {
  const isRolling = rollingEnabledInput.checked;
  if (isRolling) {
    batchSizeInput.min = "1";
    batchSizeInput.max = String(MAX_ROLLING_BATCH_SIZE);
    cooldownInput.min = String(MIN_ROLLING_COOLDOWN_SECONDS);
    cooldownInput.max = String(MAX_COOLDOWN_SECONDS);
    batchSizeHint.textContent = `1\u2013${MAX_ROLLING_BATCH_SIZE} tabs. Active tab reloads first, then left-to-right.`;
    cooldownHint.textContent = `${MIN_ROLLING_COOLDOWN_SECONDS}\u2013${MAX_COOLDOWN_SECONDS} seconds between each batch.`;
    rollingHint.textContent = "Active-tab-first, then left-to-right serial reload.";
  } else {
    batchSizeInput.min = "1";
    batchSizeInput.removeAttribute("max");
    cooldownInput.min = String(MIN_COOLDOWN_SECONDS);
    cooldownInput.removeAttribute("max");
    batchSizeHint.textContent = "Number of tabs to reload simultaneously.";
    cooldownHint.textContent = `Minimum ${MIN_COOLDOWN_SECONDS} seconds between each batch.`;
    rollingHint.textContent = "Active-tab-first, then left-to-right serial reload.";
  }
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get([
    "rollingEnabled",
    "batchSize",
    "cooldownSeconds",
  ]);
  const settings = normalizeSettings(stored);
  rollingEnabledInput.checked = settings.rollingEnabled;
  batchSizeInput.value = String(settings.batchSize);
  cooldownInput.value = String(settings.cooldownSeconds);
  syncInputConstraints();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("");

  const settings = normalizeSettings({
    rollingEnabled: rollingEnabledInput.checked,
    batchSize: batchSizeInput.value,
    cooldownSeconds: cooldownInput.value,
  });

  rollingEnabledInput.checked = settings.rollingEnabled;
  batchSizeInput.value = String(settings.batchSize);
  cooldownInput.value = String(settings.cooldownSeconds);
  syncInputConstraints();

  try {
    await chrome.storage.sync.set(settings);
    setStatus("Saved.");
  } catch (error) {
    console.error("Failed to save settings", error);
    setStatus("Failed to save settings.", true);
  }
});

rollingEnabledInput.addEventListener("change", () => {
  syncInputConstraints();
});

loadSettings().catch((error) => {
  console.error("Failed to load settings", error);
  setStatus("Failed to load settings.", true);
});
