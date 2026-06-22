chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener(async (tab) => {
  await openPanel(tab);
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "open-watchbuddy") {
    await openPanel(tab);
  }
});

async function openPanel(tab) {
  if (!tab?.windowId) return;
  await chrome.sidePanel.open({ windowId: tab.windowId });
}
