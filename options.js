const DEFAULT_ROLLING_ENABLED = true;
const ROLLING_BATCH_SIZE = 1;
const ROLLING_COOLDOWN_SECONDS = 3;
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_COOLDOWN_SECONDS = 5;
const MIN_COOLDOWN_SECONDS = 5;

const form = document.getElementById("settings-form");
const rollingEnabledInput = document.getElementById("rollingEnabled");
const batchSizeInput = document.getElementById("batchSize");
const cooldownInput = document.getElementById("cooldownSeconds");
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

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b00020" : "";
}

function syncInputLockState() {
  const isRolling = rollingEnabledInput.checked;
  batchSizeInput.disabled = isRolling;
  cooldownInput.disabled = isRolling;
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
  syncInputLockState();
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
  syncInputLockState();

  try {
    await chrome.storage.sync.set(settings);
    setStatus("Saved.");
  } catch (error) {
    console.error("Failed to save settings", error);
    setStatus("Failed to save settings.", true);
  }
});

rollingEnabledInput.addEventListener("change", () => {
  syncInputLockState();
});

loadSettings().catch((error) => {
  console.error("Failed to load settings", error);
  setStatus("Failed to load settings.", true);
});
