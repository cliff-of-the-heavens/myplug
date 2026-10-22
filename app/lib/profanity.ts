/**
 * Obscene-word filter for reviews and replies. Words are matched whole (so "class" or
 * "Scunthorpe" aren't caught), after undoing common disguises: letter-like digits and symbols
 * ("sh1t", "@ss", "f*ck"), stretched letters ("fuuuck") and separators ("f.u.c.k"). Admins add
 * more words, including local-language ones, and allow words wrongly caught, under Admin -> Reviews.
 */
const BUILT_IN = [
  "fuck", "fucker", "fucking", "fucked", "fck", "fuk", "motherfucker", "shit", "shitty", "bullshit",
  "bitch", "bastard", "asshole", "arsehole", "ass", "arse", "dick", "dickhead", "cunt", "pussy",
  "twat", "wanker", "prick", "slut", "whore", "bollocks", "crap", "damn", "piss", "pissed",
  "douche", "douchebag", "jackass", "nigger", "nigga", "faggot", "retard", "retarded", "porn",
  "dildo", "tits", "jizz",
];

const LOOKALIKE: Record<string, string> = { "0": "o", "1": "i", "!": "i", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t", "+": "t", "*": "u" };

/** Lower-case letters only, with look-alike characters mapped back to letters. */
function letters(token: string) {
  let out = "";
  for (const ch of token.toLowerCase()) {
    const c = LOOKALIKE[ch] ?? ch;
    if (/\p{L}/u.test(c)) out += c;
  }
  return out;
}

/** Runs of the same letter squeezed to one ("fuuuck" -> "fuck"). */
const squeeze = (s: string) => s.replace(/(\p{L})\1+/gu, "$1");

export function parseWordList(text: string | null | undefined) {
  return (text ?? "")
    .split(/[\s,;]+/)
    .map(letters)
    .filter((w) => w.length >= 2);
}

export type WordLists = { extra?: string[]; allow?: string[] };

function compile({ extra = [], allow = [] }: WordLists) {
  const allowed = new Set(allow.map(letters));
  const exact = new Set([...BUILT_IN, ...extra.map(letters)].filter((w) => !allowed.has(w)));
  return { exact, squeezed: new Set([...exact].map(squeeze)), allowed };
}

// A "word": letters, digits and "@"/"$", with look-alike symbols ("!", "*", "+") or single
// separators allowed only between them, so a trailing "!" stays punctuation.
const CORE = String.raw`[\p{L}\p{N}@$]+`;
const TOKEN = new RegExp(String.raw`${CORE}(?:(?:[!*+]+|[.\-_])${CORE})*`, "gu");

function isBad(token: string, lists: ReturnType<typeof compile>) {
  const w = letters(token);
  if (w.length < 2 || lists.allowed.has(w)) return false;
  if (lists.exact.has(w)) return true;
  // Plurals and -ing forms: "shits", "bitches", "pissing".
  if ([/s$/, /es$/, /ing$/].some((re) => re.test(w) && lists.exact.has(w.replace(re, "")))) return true;
  // Stretched spellings only count when letters really were repeated, so "as", "Bobs" or
  // "Niger" never match the squeezed forms of "ass", "boobs" or a slur.
  const s = squeeze(w);
  return s !== w && lists.squeezed.has(s);
}

/** The obscene words found in a text (as written), for warnings. */
export function findObscene(text: string, lists: WordLists = {}) {
  const compiled = compile(lists);
  return [...text.matchAll(TOKEN)].map((m) => m[0]).filter((t) => isBad(t, compiled));
}

/** Replaces each obscene word with its first letter and asterisks: "shit" -> "s***". */
export function maskObscene(text: string, lists: WordLists = {}) {
  const compiled = compile(lists);
  return text.replace(TOKEN, (t) => (isBad(t, compiled) ? t[0] + "*".repeat(Math.max(t.length - 1, 2)) : t));
}
