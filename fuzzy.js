// fzf-style (v1) fuzzy matcher: find the shortest window containing the
// pattern as a subsequence, then score it with bonuses for word boundaries,
// camelCase humps and consecutive runs, and penalties for gaps.
// Smart case: case-insensitive unless the pattern contains an uppercase letter.

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

// Returns { score, positions } or null if `pattern` doesn't match `text`.
function fuzzyMatch(pattern, text) {
  let p = pattern;
  let t = text;
  if (!/[A-Z]/.test(pattern)) {
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
