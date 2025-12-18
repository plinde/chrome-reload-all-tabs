// Reload all tabs in current window
async function reloadAllTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  for (const t of tabs) {
    chrome.tabs.reload(t.id);
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
