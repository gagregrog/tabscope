// User settings, shared by the picker and the options page.

const DEFAULT_SETTINGS = {
  // 0 accepts any match with the letters in order; 100 requires a perfect
  // match (every letter consecutive, starting at a word boundary).
  strictness: 0,
  // "smart": case-insensitive unless the query has an uppercase letter.
  caseMode: "smart", // "smart" | "ignore" | "respect"
  matchUrls: true,
  // How results are ordered while searching. With no query they are always
  // most recently used first.
  sortBy: "score", // "score" | "recent"
};

async function loadSettings() {
  try {
    return await chrome.storage.sync.get(DEFAULT_SETTINGS);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
