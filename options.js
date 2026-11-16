// Settings form, saved as you change it, with a live preview against your
// open tabs so you can see what the strictness slider keeps and drops.

const PREVIEW_LIMIT = 20;

const $ = (id) => document.getElementById(id);
const $strictness = $("strictness");
const $tryQuery = $("tryQuery");

let settings = DEFAULT_SETTINGS;
let entries = [];
let savedTimer = 0;

function strictnessHelp(value) {
  if (value === 0) return "Any tab whose title or URL contains your letters in order.";
  if (value < 50) return "Drops matches whose letters are strewn across a long title or URL.";
  if (value < 75) return "Letters should be mostly together or at word starts. Removes most noise.";
  if (value < 100) return "Only close-to-exact matches: consecutive letters at the start of words.";
  return "Exact: your letters must appear together, starting at a word.";
}

async function save(patch) {
  Object.assign(settings, patch);
  await chrome.storage.sync.set(patch);
  $("saved").textContent = "Saved";
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($("saved").textContent = ""), 1200);
  renderTry();
}

function renderStrictness() {
  $("strictnessValue").textContent = String(settings.strictness);
  $("strictnessHelp").textContent = strictnessHelp(settings.strictness);
}

// Shows the loose matches, marking the ones the current strictness drops.
function renderTry() {
  const terms = $tryQuery.value.trim().split(/\s+/).filter(Boolean);
  const list = $("tryResults");
  if (!terms.length) {
    list.replaceChildren();
    $("tryCount").textContent = `${entries.length} open tabs.`;
    return;
  }
  const loose = { ...settings, strictness: 0 };
  const minQuality = settings.strictness / 100;
  const matches = entries
    .map((e) => scoreEntry(e, terms, loose))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  const kept = matches.filter((m) => m.quality >= minQuality || minQuality === 0).length;
  $("tryCount").textContent = `${kept} of ${matches.length} matching tabs kept at strictness ${settings.strictness}.`;

  list.replaceChildren(
    ...matches.slice(0, PREVIEW_LIMIT).map((m) => {
      const li = document.createElement("li");
      if (minQuality > 0 && m.quality < minQuality) li.className = "dropped";
      const quality = document.createElement("span");
      quality.className = "quality";
      quality.textContent = String(Math.max(0, Math.round(m.quality * 100)));
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = m.entry.title;
      const url = document.createElement("span");
      url.className = "url";
      url.textContent = m.entry.url;
      li.append(quality, title, url);
      return li;
    }),
  );
}

async function renderShortcuts() {
  const commands = await chrome.commands.getAll();
  const dl = $("shortcuts");
  dl.replaceChildren();
  for (const c of commands) {
    const dt = document.createElement("dt");
    dt.textContent = c.name === "_execute_action" ? "Open the toolbar popup" : c.description;
    const dd = document.createElement("dd");
    dd.textContent = c.shortcut || "Not set";
    if (!c.shortcut) dd.className = "unset";
    dl.append(dt, dd);
  }
}

async function init() {
  settings = await loadSettings();
  $strictness.value = String(settings.strictness);
  $("caseMode").value = settings.caseMode;
  $("matchUrls").checked = settings.matchUrls;
  document.querySelector(`input[name="sortBy"][value="${settings.sortBy}"]`).checked = true;
  renderStrictness();

  const self = chrome.runtime.getURL("");
  entries = (await chrome.tabs.query({})).filter((t) => !(t.url || "").startsWith(self)).map(tabEntry);
  renderTry();
  renderShortcuts();
}

$strictness.addEventListener("input", () => {
  settings.strictness = Number($strictness.value);
  renderStrictness();
  renderTry();
});
$strictness.addEventListener("change", () => save({ strictness: Number($strictness.value) }));
$("caseMode").addEventListener("change", (e) => save({ caseMode: e.target.value }));
$("matchUrls").addEventListener("change", (e) => save({ matchUrls: e.target.checked }));
document.querySelectorAll('input[name="sortBy"]').forEach((radio) =>
  radio.addEventListener("change", (e) => save({ sortBy: e.target.value })),
);
$tryQuery.addEventListener("input", renderTry);
$("editShortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
// Shortcut changes happen on another page; refresh when we come back.
window.addEventListener("focus", renderShortcuts);

init();
