// Reload all tabs in current window when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  const tabs = await chrome.tabs.query({ currentWindow: true });

  for (const t of tabs) {
    chrome.tabs.reload(t.id);
  }
});
