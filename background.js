// Hotkey: inject the overlay into the current page. Pages that can't be
// scripted (brave://, the Web Store, the new tab page, PDFs) fall back to
// the toolbar popup, or a small popup window if that isn't allowed either.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "open-tabscope") return;
  tab ??= (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["overlay.js"],
    });
  } catch {
    openFallback();
  }
});

async function openFallback() {
  try {
    await chrome.action.openPopup();
  } catch {
    chrome.windows.create({
      url: "palette.html",
      type: "popup",
      width: 800,
      height: 520,
    });
  }
}

// The palette asks us to switch tabs so the switch finishes even if the
// palette's frame is torn down mid-way (e.g. the action popup closing).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "activate") return;
  (async () => {
    await chrome.tabs.update(msg.tabId, { active: true });
    await chrome.windows.update(msg.windowId, { focused: true });
  })().then(
    () => sendResponse(true),
    () => sendResponse(false),
  );
  return true;
});
