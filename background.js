// Commands, plus a most-recently-used (MRU) list of tabs across all windows,
// which drives the picker's ordering, the quick swap and the back/forward walk.
//
// The walk works like a vim jumplist. Walking back steps through a snapshot of
// the MRU list without reordering it, so repeated presses keep going further
// back instead of bouncing between two tabs. The walk ends when a tab is
// activated any other way; the tab it stopped on then counts as visited.
//
// The service worker can be stopped at any time, so the state lives in
// storage.session (kept until the browser quits, like tab IDs).

let state = null; // { mru: tabId[], walk: { list: tabId[], index } | null }
let queue = Promise.resolve();

// Run state changes one at a time; events and commands interleave otherwise.
function serial(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

async function getState() {
  if (state) return state;
  const { nav } = await chrome.storage.session.get("nav");
  if (nav) return (state = nav);
  const tabs = await chrome.tabs.query({});
  tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return (state = { mru: tabs.map((t) => t.id), walk: null });
}

function saveState() {
  return chrome.storage.session.set({ nav: state });
}

function promote(s, tabId) {
  s.mru = [tabId, ...s.mru.filter((id) => id !== tabId)];
}

function endWalk(s) {
  if (!s.walk) return;
  promote(s, s.walk.list[s.walk.index]);
  s.walk = null;
}

async function focusTab(tabId) {
  const tab = await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

function visited(tabId) {
  return serial(async () => {
    const s = await getState();
    // Our own walk landing on a tab, or its window gaining focus.
    if (s.walk?.list[s.walk.index] === tabId) return;
    endWalk(s);
    promote(s, tabId);
    await saveState();
  });
}

chrome.tabs.onActivated.addListener(({ tabId }) => visited(tabId));

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab) visited(tab.id);
});

chrome.tabs.onRemoved.addListener((tabId) =>
  serial(async () => {
    const s = await getState();
    s.mru = s.mru.filter((id) => id !== tabId);
    if (s.walk) {
      const i = s.walk.list.indexOf(tabId);
      if (i === s.walk.index) s.walk = null;
      else if (i >= 0) {
        s.walk.list.splice(i, 1);
        if (i < s.walk.index) s.walk.index--;
      }
    }
    await saveState();
  }),
);

// Prerendering can swap a tab for a new one with a different ID.
chrome.tabs.onReplaced.addListener((added, removed) =>
  serial(async () => {
    const s = await getState();
    const swap = (id) => (id === removed ? added : id);
    s.mru = s.mru.map(swap);
    if (s.walk) s.walk.list = s.walk.list.map(swap);
    await saveState();
  }),
);

// Moves the walk `step` places (+1 = further back), skipping closed tabs.
function walk(step) {
  return serial(async () => {
    const s = await getState();
    if (!s.walk) {
      if (step < 0) return;
      s.walk = { list: [...s.mru], index: 0 };
    }
    const w = s.walk;
    const start = w.index;
    for (let i = start + step; i >= 0 && i < w.list.length; i += step) {
      try {
        // Saved before focusing, so visited() recognizes the activation as ours.
        w.index = i;
        await saveState();
        await focusTab(w.list[i]);
        return;
      } catch {
        // Tab is gone; try the next one.
      }
    }
    w.index = start;
    await saveState();
  });
}

function swapToPrevious() {
  return serial(async () => {
    const s = await getState();
    endWalk(s);
    await saveState();
    for (const tabId of s.mru.slice(1)) {
      try {
        await focusTab(tabId);
        return;
      } catch {
        // Tab is gone; try the next one.
      }
    }
  });
}

// Injects the picker overlay into the current page. Pages that can't be
// scripted (brave://, the Web Store, the new tab page, PDFs) fall back to the
// toolbar popup, or a small popup window if that isn't allowed either.
async function openPicker(tab) {
  tab ??= (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["overlay.js"],
    });
  } catch {
    openFallback();
  }
}

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

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "open-tabscope") openPicker(tab);
  else if (command === "previous-tab") swapToPrevious();
  else if (command === "walk-back") walk(1);
  else if (command === "walk-forward") walk(-1);
});

async function listTabs() {
  const [tabs, [active], mru] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabs.query({ active: true, lastFocusedWindow: true }),
    serial(async () => (await getState()).mru),
  ]);
  return { tabs, activeId: active?.id ?? null, mru };
}

// Returns whether the tab is gone. Zen keeps pinned tabs (including tabs in
// folders) open when asked to close them.
async function closeTab(tabId) {
  await chrome.tabs.remove(tabId);
  try {
    await chrome.tabs.get(tabId);
    return false;
  } catch {
    return true;
  }
}

// The palette does all tab work through these messages. Firefox gives an
// extension frame inside a web page only content-script APIs, so the overlay
// has no chrome.tabs. A switch sent here also finishes if the palette's frame
// is torn down mid-way (e.g. the action popup closing).
const handlers = {
  "list-tabs": () => listTabs(),
  activate: (msg) => focusTab(msg.tabId).then(() => true),
  "close-tab": (msg) => closeTab(msg.tabId),
  "open-options": () => chrome.runtime.openOptionsPage(),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return;
  handler(msg).then(
    (result) => sendResponse({ ok: true, result }),
    (err) => sendResponse({ ok: false, error: String(err?.message ?? err) }),
  );
  return true;
});
