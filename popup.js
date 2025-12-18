document.addEventListener('DOMContentLoaded', async () => {
  const reloadBtn = document.getElementById('reloadAll');
  const bypassCacheCheckbox = document.getElementById('bypassCache');
  const tabCountEl = document.getElementById('tabCount');
  const statusEl = document.getElementById('status');

  // Load saved preference for bypass cache
  const stored = await chrome.storage.local.get(['bypassCache']);
  if (stored.bypassCache !== undefined) {
    bypassCacheCheckbox.checked = stored.bypassCache;
  }

  // Save preference when changed
  bypassCacheCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ bypassCache: bypassCacheCheckbox.checked });
  });

  // Get and display current window's tab count
  async function updateTabCount() {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    tabCountEl.textContent = tabs.length;
    return tabs;
  }

  await updateTabCount();

  // Handle reload button click
  reloadBtn.addEventListener('click', async () => {
    reloadBtn.classList.add('loading');
    reloadBtn.disabled = true;

    const tabs = await chrome.tabs.query({ currentWindow: true });
    const bypassCache = bypassCacheCheckbox.checked;

    // Reload all tabs
    const reloadPromises = tabs.map(tab => {
      return chrome.tabs.reload(tab.id, { bypassCache });
    });

    await Promise.all(reloadPromises);

    // Show success status
    statusEl.textContent = `Reloaded ${tabs.length} tab${tabs.length !== 1 ? 's' : ''}`;
    statusEl.classList.add('show');

    reloadBtn.classList.remove('loading');
    reloadBtn.disabled = false;

    // Hide status after delay
    setTimeout(() => {
      statusEl.classList.remove('show');
    }, 2000);
  });
});
