// fzf-style (v1) fuzzy matcher: find the shortest window containing the
// pattern as a subsequence, then score it with bonuses for word boundaries,
// camelCase humps and consecutive runs, and penalties for gaps.

const SCORE_MATCH = 16;
const PENALTY_GAP_START = -3;
const PENALTY_GAP_EXTENSION = -1;
const BONUS_BOUNDARY = 8;
const BONUS_CAMEL = 7;
const BONUS_CONSECUTIVE = 4;
const BONUS_FIRST_CHAR_MULTIPLIER = 2;

const NON_WORD = 0, LOWER = 1, UPPER = 2, DIGIT = 3;

function charClass(c) {
  if (c >= "a" && c <= "z") return LOWER;
  if (c >= "A" && c <= "Z") return UPPER;
  if (c >= "0" && c <= "9") return DIGIT;
  return NON_WORD;
}

function bonusAt(text, i) {
  if (i === 0) return BONUS_BOUNDARY;
  const prev = charClass(text[i - 1]);
  const cur = charClass(text[i]);
  if (prev === NON_WORD && cur !== NON_WORD) return BONUS_BOUNDARY;
  if (prev === LOWER && cur === UPPER) return BONUS_CAMEL;
  if (prev !== DIGIT && cur === DIGIT) return BONUS_CAMEL;
  return 0;
}

// The best score a pattern of this length can get: every character
// consecutive, starting at a word boundary.
function perfectScore(length) {
  return SCORE_MATCH * length + BONUS_BOUNDARY * (BONUS_FIRST_CHAR_MULTIPLIER + length - 1);
}

// Returns { score, positions } or null if `pattern` doesn't match `text`.
// caseMode "smart" is case-insensitive unless the pattern has an uppercase letter.
function fuzzyMatch(pattern, text, caseMode = "smart") {
  const ignoreCase = caseMode === "ignore" || (caseMode === "smart" && !/[A-Z]/.test(pattern));
  let p = pattern;
  let t = text;
  if (ignoreCase) {
    p = pattern.toLowerCase();
    const lowered = text.toLowerCase();
    // Rare Unicode lowercasing changes length; keep indices aligned instead.
    if (lowered.length === text.length) t = lowered;
  }

  // Forward pass: earliest end of a subsequence match.
  let pi = 0;
  let end = -1;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === p[pi] && ++pi === p.length) {
      end = i + 1;
      break;
    }
  }
  if (end < 0) return null;

  // Backward pass: latest start, giving the tightest window.
  pi = p.length - 1;
  let start = 0;
  for (let i = end - 1; i >= 0; i--) {
    if (t[i] === p[pi] && --pi < 0) {
      start = i;
      break;
    }
  }

  let score = 0;
  const positions = [];
  let inGap = false;
  let consecutive = 0;
  let firstBonus = 0;
  pi = 0;
  for (let i = start; i < end; i++) {
    if (t[i] === p[pi]) {
      let bonus = bonusAt(text, i);
      if (consecutive === 0) {
        firstBonus = bonus;
      } else {
        // A run inherits the bonus of the boundary it started on.
        if (bonus >= BONUS_BOUNDARY && bonus > firstBonus) firstBonus = bonus;
        bonus = Math.max(bonus, firstBonus, BONUS_CONSECUTIVE);
      }
      score += SCORE_MATCH + (pi === 0 ? bonus * BONUS_FIRST_CHAR_MULTIPLIER : bonus);
      positions.push(i);
      pi++;
      consecutive++;
      inGap = false;
    } else {
      score += inGap ? PENALTY_GAP_EXTENSION : PENALTY_GAP_START;
      inGap = true;
      consecutive = 0;
      firstBonus = 0;
    }
  }
  return { score, positions };
}

// Matches an entry ({ title, url }) against space-separated terms. Every term
// must match the title or URL. Each term's quality is its score as a fraction
// of perfectScore, and settings.strictness (0-100) sets the minimum quality.
// Returns { entry, score, quality, titlePos, urlPos } or null.
function scoreEntry(entry, terms, settings) {
  const minQuality = settings.strictness / 100;
  let score = 0;
  let quality = 1;
  const titlePos = new Set();
  const urlPos = new Set();
  for (const term of terms) {
    const t = fuzzyMatch(term, entry.title, settings.caseMode);
    const u = settings.matchUrls ? fuzzyMatch(term, entry.url, settings.caseMode) : null;
    const useTitle = t && (!u || t.score >= u.score);
    const best = useTitle ? t : u;
    if (!best) return null;
    const termQuality = best.score / perfectScore(term.length);
    if (minQuality > 0 && termQuality < minQuality) return null;
    score += best.score;
    quality = Math.min(quality, termQuality);
    best.positions.forEach((p) => (useTitle ? titlePos : urlPos).add(p));
  }
  return { entry, score, quality, titlePos, urlPos };
}

// The entry the matcher works on for a tab: its title and a display URL
// without the scheme, "www." or trailing slash.
function tabEntry(tab) {
  const url = tab.url || tab.pendingUrl || "";
  const short = url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  return { tab, title: tab.title || url, url: short };
}
