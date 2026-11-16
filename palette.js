// Picker UI. Runs either inside the page overlay iframe (?mode=overlay) or as
// the toolbar popup / fallback popup window.

const MODE = new URLSearchParams(location.search).get("mode") === "overlay" ? "overlay" : "popup";
const MAX_RENDERED = 300;
const SELF_PREFIX = chrome.runtime.getURL("");
const FAVICON_BASE = chrome.runtime.getURL("/_favicon/");

const $query = document.getElementById("query");
const $results = document.getElementById("results");
const $preview = document.getElementById("preview");
const $count = document.getElementById("count");

let entries = []; // { tab, title, url, rank } for every open tab, by rank
let items = []; // filtered + ordered: { entry, score, quality, titlePos, urlPos }
let selected = 0;
let currentTabId = null;
let settings = DEFAULT_SETTINGS;
const windowNumbers = new Map();

document.body.classList.add(MODE);

function closePalette() {
  if (MODE === "overlay") parent.postMessage({ tabscope: "close" }, "*");
  else window.close();
}

// Reloading the extension cuts a still-open overlay off from the chrome.*
// APIs (they throw "Extension context invalidated"), so it just closes.
function extensionAlive() {
  if (chrome.runtime?.id) return true;
  closePalette();
  return false;
}

function faviconUrl(pageUrl, size) {
  const url = new URL(FAVICON_BASE);
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", String(size));
  return url.href;
}

async function load() {
  const [all, [active], mru, loaded] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabs.query({ active: true, lastFocusedWindow: true }),
    chrome.runtime.sendMessage({ type: "get-mru" }).catch(() => []),
    loadSettings(),
  ]);
  settings = loaded;
  currentTabId = active?.id ?? null;
  for (const tab of all) {
    if (!windowNumbers.has(tab.windowId)) windowNumbers.set(tab.windowId, windowNumbers.size + 1);
  }

  // Most recently used first (falling back to lastAccessed for tabs the MRU
  // list hasn't seen), with the tab you're on last, so ⏎ on an empty query
  // jumps back to the previous tab.
  const mruIndex = new Map((mru ?? []).map((id, i) => [id, i]));
  const isCurrent = (tab) => (tab.id === currentTabId ? 1 : 0);
  const mruPos = (tab) => mruIndex.get(tab.id) ?? mruIndex.size;

  entries = all
    .filter((tab) => !(tab.url || "").startsWith(SELF_PREFIX))
    .map(tabEntry)
    .sort(
      ({ tab: a }, { tab: b }) =>
        isCurrent(a) - isCurrent(b) || mruPos(a) - mruPos(b) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0),
    );
  entries.forEach((e, i) => (e.rank = i));
  update();
}

function update() {
  const terms = $query.value.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    items = entries.map((entry) => ({ entry, score: 0, quality: 1, titlePos: new Set(), urlPos: new Set() }));
  } else {
    items = entries.map((e) => scoreEntry(e, terms, settings)).filter(Boolean);
    if (settings.sortBy === "score") items.sort((a, b) => b.score - a.score || a.entry.rank - b.entry.rank);
  }
  selected = 0;
  render();
}

function highlighted(text, positions) {
  const frag = document.createDocumentFragment();
  let run = "";
  let runIsMatch = false;
  const flush = () => {
    if (!run) return;
    if (runIsMatch) {
      const span = document.createElement("span");
      span.className = "match";
      span.textContent = run;
      frag.append(span);
    } else {
      frag.append(run);
    }
    run = "";
  };
  for (let i = 0; i < text.length; i++) {
    const isMatch = positions.has(i);
    if (isMatch !== runIsMatch) flush();
    runIsMatch = isMatch;
    run += text[i];
  }
  flush();
  return frag;
}

function render() {
  const frag = document.createDocumentFragment();
  items.slice(0, MAX_RENDERED).forEach((item, i) => {
    const li = document.createElement("li");
    li.dataset.i = String(i);

    const caret = document.createElement("span");
    caret.className = "caret";

    const icon = document.createElement("img");
    icon.className = "icon";
    icon.src = faviconUrl(item.entry.tab.url || "", 32);

    const title = document.createElement("span");
    title.className = "title";
    title.append(highlighted(item.entry.title, item.titlePos));

    const url = document.createElement("span");
    url.className = "url";
    url.append(highlighted(item.entry.url, item.urlPos));

    li.append(caret, icon, title, url);
    frag.append(li);
  });
  $results.replaceChildren(frag);
  $count.textContent = `${items.length} / ${entries.length}`;
  renderSelection();
}

function renderSelection() {
  $results.querySelector(".selected")?.classList.remove("selected");
  const li = $results.children[selected];
  if (li) {
    li.classList.add("selected");
    li.scrollIntoView({ block: "nearest" });
  }
  renderPreview(items[selected]);
}

function relativeTime(ms) {
  if (!ms) return "—";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function renderPreview(item) {
  if (!item) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = entries.length ? "No matching tabs" : "Loading…";
    $preview.replaceChildren(empty);
    return;
  }
  const { tab } = item.entry;

  const head = document.createElement("div");
  head.className = "head";
  const icon = document.createElement("img");
  icon.src = faviconUrl(tab.url || "", 64);
  const h2 = document.createElement("h2");
  h2.append(highlighted(item.entry.title, item.titlePos));
  head.append(icon, h2);

  const fullUrl = document.createElement("p");
  fullUrl.className = "fullurl";
  fullUrl.textContent = tab.url || tab.pendingUrl || "";

  const status = [];
  if (tab.id === currentTabId) status.push("current tab");
  else if (tab.active) status.push("active in its window");
  if (tab.pinned) status.push("pinned");
  if (tab.audible) status.push("playing audio");
  if (tab.mutedInfo?.muted) status.push("muted");
  if (tab.discarded || tab.frozen) status.push("sleeping");
  if (tab.status === "loading") status.push("loading");

  const rows = [
    ["Window", `${windowNumbers.get(tab.windowId)} of ${windowNumbers.size}${tab.incognito ? " (private)" : ""}`],
    ["Position", `tab ${tab.index + 1}`],
    ["Last viewed", tab.id === currentTabId ? "now" : relativeTime(tab.lastAccessed)],
  ];
  if (status.length) rows.push(["Status", status.join(", ")]);

  const dl = document.createElement("dl");
  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    dl.append(dt, dd);
  }

  $preview.replaceChildren(head, fullUrl, dl);
}

function move(delta) {
  const count = Math.min(items.length, MAX_RENDERED);
  if (!count) return;
  selected = (selected + delta + count) % count;
  renderSelection();
}

function moveClamped(delta) {
  const count = Math.min(items.length, MAX_RENDERED);
  if (!count) return;
  selected = Math.max(0, Math.min(count - 1, selected + delta));
  renderSelection();
}

async function activateSelected() {
  const item = items[selected];
  if (!item) return;
  const { id, windowId } = item.entry.tab;
  await chrome.runtime.sendMessage({ type: "activate", tabId: id, windowId });
  closePalette();
}

function openSettings() {
  chrome.runtime.openOptionsPage();
  closePalette();
}

async function closeSelectedTab() {
  const item = items[selected];
  if (!item) return;
  const { id } = item.entry.tab;
  await chrome.tabs.remove(id);
  entries = entries.filter((e) => e.tab.id !== id);
  items.splice(selected, 1);
  selected = Math.max(0, Math.min(selected, items.length - 1));
  render();
}

document.addEventListener("keydown", (e) => {
  if (!extensionAlive()) return;
  const ctrl = e.ctrlKey && !e.metaKey && !e.altKey;
  let handled = true;
  if (e.key === "Escape" || (ctrl && e.key === "c")) closePalette();
  else if (e.key === "Enter") activateSelected();
  else if (e.key === "ArrowDown" || (ctrl && (e.key === "n" || e.key === "j"))) move(1);
  else if (e.key === "ArrowUp" || (ctrl && (e.key === "p" || e.key === "k"))) move(-1);
  else if (e.key === "PageDown") moveClamped(10);
  else if (e.key === "PageUp") moveClamped(-10);
  else if ((ctrl && e.key === "d") || (e.altKey && e.code === "KeyD")) closeSelectedTab();
  else if (ctrl && e.key === "u") {
    $query.value = "";
    update();
  } else if (ctrl && e.key === ",") openSettings();
  else handled = false;
  if (handled) e.preventDefault();
});

$query.addEventListener("input", () => extensionAlive() && update());

$results.addEventListener("mousemove", (e) => {
  if (!extensionAlive()) return;
  const li = e.target.closest("li");
  if (li && Number(li.dataset.i) !== selected) {
    selected = Number(li.dataset.i);
    renderSelection();
  }
});
$results.addEventListener("click", (e) => {
  if (e.target.closest("li") && extensionAlive()) activateSelected();
});

document.getElementById("backdrop").addEventListener("mousedown", closePalette);
document.getElementById("settings").addEventListener("click", () => extensionAlive() && openSettings());

// Keep typing focus in the prompt no matter where you click.
document.addEventListener("mousedown", (e) => {
  if (e.target !== $query) e.preventDefault();
});
window.addEventListener("focus", () => $query.focus());

$query.focus();
renderPreview(null);
load();
