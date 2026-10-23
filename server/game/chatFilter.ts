/**
 * Kid-safe chat / name filter (docs/netcode/PROTOCOL.md "Global chat", "Moderation"). Server-only, pure.
 *
 * `moderateText(text)` classifies already-sanitized text into one of three outcomes:
 *  - `{ action: "allow" }`              nothing found;
 *  - `{ action: "mask", text }`         only MILD profanity: those words are replaced with asterisks;
 *  - `{ action: "drop", category }`     a SEVERE hit (slur / hate, sexual, self-harm or sexual/violent
 *                                       threat) or a CHILD-SAFETY hit (link, email, phone, request for
 *                                       age / location / contact on another app). The whole line is refused.
 *
 * Detection runs on a normalized "view" of the text, with a per-character map back to the original so
 * masking hits exactly the right characters:
 *  1. per code point: NFKD (fullwidth "ｆ", math "𝐟", circled "ⓕ" → "f"), combining marks removed
 *     ("fùck"), lower-cased, then a homoglyph table (Cyrillic / Greek look-alikes, "к" → "k") and a
 *     leet table ("0"→o, "1"→i, "3"→e, "4"/"@"→a, "5"/"$"→s, "7"→t). Astral chars (emoji) become spaces.
 *  2. letter-spacing runs are joined: 3+ single letters separated by spaces / punctuation
 *     ("f u c k", "s.h.i.t", "k-y-s") are read as one word.
 *  3. the `obscenity` matcher (MIT, jo3-l/obscenity: English dataset + its confusable / leet /
 *     repeated-letter transformers and whitelists) plus our own extra patterns run over the view;
 *     hits inside SAFE_TERMS (Scunthorpe-style false positives we found) are ignored.
 *  4. phrase regexes (threats, hate phrases, contact / personal-info requests) run over a
 *     space-normalized form of the view; link / email / phone regexes run over a non-leet form (so
 *     digits stay digits).
 *
 * Pirate words allowed for a kid audience: "damn", "hell", "bloody", "blast", "crap", "scurvy", "bilge
 * rat". "bastard", "cock", "dick" and other mild words are now masked, not allowed.
 */
import {
  DataSet,
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
  parseRawPattern,
} from "obscenity";

export type DropCategory = "slur" | "sexual" | "threat" | "link" | "email" | "phone" | "personal";

export type ModerationResult =
  | { action: "allow" }
  | { action: "mask"; text: string }
  | { action: "drop"; category: DropCategory };

// ---------------------------------------------------------------------------------------------
// Tiers for the obscenity dataset (keyed by `originalWord`) and our own additions
// ---------------------------------------------------------------------------------------------

/**
 * Mild profanity is masked. Every dataset word NOT in SEVERE_WORDS is mild: fuck, shit, ass, arse, bitch,
 * bastard, piss, prick, twat, wank, bollocks, turd, dick, cock, cuck, boob, tit, hooker, plus "x-mild".
 */

/** Severe words by category: the line is dropped. */
const SEVERE_WORDS: Record<string, DropCategory> = {
  // slurs / hate
  abeed: "slur", abo: "slur", africoon: "slur", arabush: "slur", boonga: "slur", chingchong: "slur",
  chink: "slur", dyke: "slur", fag: "slur", kike: "slur", negro: "slur", nigger: "slur", retard: "slur",
  spastic: "slur", tranny: "slur", "x-slur": "slur",
  // sexual
  anal: "sexual", anus: "sexual", bestiality: "sexual", blowjob: "sexual", buttplug: "sexual", cum: "sexual",
  cunt: "sexual", deepthroat: "sexual", dildo: "sexual", doggystyle: "sexual", "double penetration": "sexual",
  ejaculate: "sexual", felch: "sexual", fellatio: "sexual", "finger bang": "sexual", fisting: "sexual",
  gangbang: "sexual", handjob: "sexual", hentai: "sexual", incest: "sexual", "jerk off": "sexual", jizz: "sexual",
  lubejob: "sexual", masturbate: "sexual", orgasm: "sexual", orgy: "sexual", penis: "sexual", porn: "sexual",
  pussy: "sexual", rape: "sexual", scat: "sexual", semen: "sexual", sex: "sexual", slut: "sexual",
  vagina: "sexual", whore: "sexual", "x-sexual": "sexual",
};

type Meta = { originalWord: string };

/** Our own word-level additions, in obscenity pattern syntax (`|` = word boundary, `[x]` optional). */
const EXTRA_PATTERNS: Array<[string, string[]]> = [
  ["x-mild", ["|phuck", "|fuk", "|fcuk", "|dumbass", "|jackass", "|smartass", "|fatass", "|badass", "|asshat", "|wtf|", "|stfu|", "|dipshit", "|bullshit"]],
  [
    "x-slur",
    [
      "|spic|", "|spics|", "|wetback", "|beaner", "|gook", "|raghead", "|towelhead", "|paki|", "|pakis|", "|coon|",
      "|coons|", "|jigaboo", "|golliwog", "|kyke", "|shemale", "|homo|", "|homos|", "|lesbo", "|nazi", "|hitler",
      "|kkk|", "|faggot", "|fagot", "|nigga", "|niga|", "|nig|", "|negroid", "|tard|", "|retarded",
    ],
  ],
  [
    "x-sexual",
    [
      "|horny", "|nude|", "|nudes|", "|nudity", "|naked", "|boner", "|erection", "|milf", "|thot|", "|thots|",
      "|rimjob", "|cumshot", "|sexting", "|sext|", "|pedo", "|paedo", "|molest", "|onlyfans", "|titties", "|tiddies",
      "|clit", "|testicle", "|ballsack", "|nutsack", "|blow job", "|hand job", "|cumming",
    ],
  ],
];

/** Innocent words that contain a listed pattern (Scunthorpe problem). Matches fully inside one of these are ignored. */
const SAFE_TERMS = [
  "shiitake", "shitake", "cumin", "cumulus", "cumulative", "cockpit", "cockpits", "cockswain", "cockatoo",
  "cockatiel", "cockroach", "cockle", "cockles", "cockney", "cocker spaniel", "cocked hat", "moby dick",
  "dickens", "dickinson", "dick turpin", "rio negro", "cabo negro", "penistone", "wankel", "pussycat",
  "pussy willow", "hancock", "peacock", "scunthorpe", "homo sapiens", "homo erectus", "spick and span",
  "sextant", "sextants", "sexton", "sussex", "essex", "middlesex", "nazareth", "tit for tat", "titmouse",
  "titan", "title", "analysis", "analyse", "analyze", "canal", "banal", "therapist", "grape", "drape",
  "scrape", "assassin", "class", "pass", "bass", "compass", "cutlass", "molasses", "assume", "assist",
  "scatter", "scattered", "cocoon", "raccoon", "tycoon", "nigeria", "niger", "snigger",
];

function buildDataSet(): DataSet<Meta> {
  const ds = new DataSet<Meta>().addAll(englishDataset);
  for (const [word, pats] of EXTRA_PATTERNS) {
    ds.addPhrase((p) => {
      p.setMetadata({ originalWord: word });
      for (const s of pats) p.addPattern(parseRawPattern(s));
      return p;
    });
  }
  return ds;
}

const DATASET = buildDataSet();
const MATCHER = new RegExpMatcher({ ...DATASET.build(), ...englishRecommendedTransformers });

// ---------------------------------------------------------------------------------------------
// Normalized view
// ---------------------------------------------------------------------------------------------

/** Look-alike letters (Cyrillic, Greek, IPA, misc) that NFKD does not fold. Lower-case keys. */
const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic
  а: "a", б: "b", в: "b", г: "r", д: "d", е: "e", ё: "e", ж: "x", з: "3", и: "u", й: "u", к: "k", л: "n",
  м: "m", н: "h", о: "o", п: "n", р: "p", с: "c", т: "t", у: "y", ф: "f", х: "x", ц: "u", ч: "4", ш: "w",
  щ: "w", ъ: "b", ы: "bi", ь: "b", э: "e", ю: "io", я: "r", і: "i", ї: "i", ј: "j", ѕ: "s", ԁ: "d", ԛ: "q",
  ԝ: "w", ѵ: "v", ғ: "f", қ: "k", ң: "h", ү: "y", ұ: "y", һ: "h", ӏ: "i", ɡ: "g",
  // Greek
  α: "a", β: "b", γ: "y", δ: "d", ε: "e", ζ: "z", η: "n", θ: "o", ι: "i", κ: "k", λ: "l", μ: "u", ν: "v",
  ξ: "e", ο: "o", π: "n", ρ: "p", σ: "o", ς: "c", τ: "t", υ: "u", φ: "f", χ: "x", ψ: "w", ω: "w",
  // Misc Latin / symbols
  ı: "i", ł: "l", ø: "o", đ: "d", ħ: "h", ŧ: "t", ß: "ss", æ: "ae", œ: "oe", ɑ: "a", ɐ: "a", ɔ: "c", ə: "e",
  ɛ: "e", ɪ: "i", ʀ: "r", ʏ: "y", ᴀ: "a", ʙ: "b", ᴄ: "c", ᴅ: "d", ᴇ: "e", ꜰ: "f", ɢ: "g", ʜ: "h",
  ᴊ: "j", ᴋ: "k", ʟ: "l", ᴍ: "m", ɴ: "n", ᴏ: "o", ᴘ: "p", ꞯ: "q", ꜱ: "s", ᴛ: "t", ᴜ: "u", ᴠ: "v", ᴡ: "w",
  ᴢ: "z", "€": "e", "£": "l", "¢": "c", "¥": "y", "。": ".", "․": ".", "﹒": ".", "●": ".", "•": ".",
  "＠": "@", "©": "c", "®": "r",
};

/** Same-meaning leet substitutions (applied after homoglyphs; NOT in the PII view). "!" and "|" are left
 *  to obscenity's own leet transformer: folding them here would turn "(shit!)" into "shiti". */
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t" };

const COMBINING = /\p{M}/gu;

interface View {
  /** Normalized text (BMP only). */
  s: string;
  /** For each char of `s`: [start, end) code-unit range in the original text. */
  map: Array<[number, number]>;
}

function foldCodePoint(cp: string, leet: boolean): string {
  if (cp.codePointAt(0)! > 0xffff) {
    // Mathematical alphanumerics etc. fold to ASCII under NFKD; emoji etc. become a separator.
    const k = cp.normalize("NFKD");
    return k !== cp && /^[\x00-\x7f]+$/.test(k) ? k.toLowerCase() : " ";
  }
  let out = "";
  for (const ch of cp.normalize("NFKD").replace(COMBINING, "").toLowerCase()) {
    let c = HOMOGLYPHS[ch] ?? ch;
    if (leet) c = c.split("").map((x) => LEET[x] ?? x).join("");
    out += c;
  }
  return out;
}

/** Build the normalized view of `text` with its map back to the original. */
function buildView(text: string, leet: boolean): View {
  let s = "";
  const map: Array<[number, number]> = [];
  let i = 0;
  for (const cp of text) {
    const folded = foldCodePoint(cp, leet);
    for (const ch of folded) {
      s += ch;
      map.push([i, i + cp.length]);
    }
    i += cp.length;
  }
  if (leet) {
    // Punctuation not inside a word becomes a space: obscenity reads "(" as "c" and "!" as "i", so
    // "(shit!)" would otherwise be seen as "cshiti" and slip past its word boundaries.
    const chars = s.split("");
    const word = (c: string | undefined) => c !== undefined && /[a-z0-9]/.test(c);
    for (let k = 0; k < chars.length; k++) {
      if (!/[a-z0-9\s]/.test(chars[k]) && !(word(s[k - 1]) && word(s[k + 1]))) chars[k] = " ";
    }
    s = chars.join("");
  }
  return { s, map };
}

const LETTERISH = "[a-z0-9]";
/** 3+ single letters separated by 1-3 separators: "f u c k", "s.h.i.t", "k - y - s". */
const SPACED_RUN = new RegExp(`(?<![a-z0-9])${LETTERISH}(?:[^a-z0-9]{1,3}${LETTERISH}(?![a-z0-9])){2,}`, "g");

/** Join letter-spacing runs in a view (keeps the map consistent). */
function joinSpacedRuns(v: View): View {
  let s = "";
  const map: Array<[number, number]> = [];
  let last = 0;
  SPACED_RUN.lastIndex = 0;
  for (let m = SPACED_RUN.exec(v.s); m; m = SPACED_RUN.exec(v.s)) {
    for (let k = last; k < m.index; k++) {
      s += v.s[k];
      map.push(v.map[k]);
    }
    for (let k = m.index; k < m.index + m[0].length; k++) {
      if (/[a-z0-9]/.test(v.s[k])) {
        s += v.s[k];
        map.push(v.map[k]);
      }
    }
    last = m.index + m[0].length;
  }
  for (let k = last; k < v.s.length; k++) {
    s += v.s[k];
    map.push(v.map[k]);
  }
  return { s, map };
}

// ---------------------------------------------------------------------------------------------
// Phrase rules (threats, hate phrases, child safety)
// ---------------------------------------------------------------------------------------------

/** Run over the leet view with every non-letter run turned into one space ("k y s" already joined). */
const PHRASE_RULES: Array<[RegExp, DropCategory]> = [
  // self-harm encouragement and threats (pirate banter like "I'll sink you" is fine)
  [/\bkys\b|\bkill\s*(?:ur|your|yo|you)\s*sel(?:f|ves)\b|\bkill\s*urself\b|\b(?:hang|neck|shoot|end)\s*(?:ur|your|yo)\s*self\b|\bunalive\b|\bgo\s*die\b|\bdie\s*in\s*a\s*fire\b|\b(?:commit|do)\s*suicide\b|\bslit\s*(?:ur|your)\s*(?:throat|wrists?)\b/, "threat"],
  [/\b(?:i\s*(?:will|ll|ma|m\s*gonna|m\s*going\s*to|gonna)|ima|imma|gonna)\s*(?:rape|molest)\b/, "sexual"],
  [/\b(?:i\s*(?:will|ll|ma|m\s*gonna|gonna)|ima|imma)\s*(?:find|come\s*to)\s*(?:you|u|ur|your)\s*(?:house|home|irl|in\s*real\s*life)\b/, "threat"],
  // hate phrases
  [/\b(?:sieg|seig)\s*heil\b|\bheil\b|\bwhite\s*power\b|\b(?:gas|kill|hang|lynch)\s*(?:all\s*)?(?:the\s*)?(?:jews|blacks|gays|muslims|mexicans|asians|arabs|immigrants)\b/, "slur"],
  // sexual solicitation
  [/\bsend\s*(?:me\s*)?(?:ur\s*|your\s*|a\s*|some\s*)?(?:pic|pics|picture|pictures|photo|photos|selfie|nudes?|feet)\b|\bsuck\s*(?:my|me|it)\b|\b(?:wanna|want\s*to)\s*(?:have\s*)?(?:sex|bang|fuck|hook\s*up|date)\b/, "sexual"],
  // personal info and moving off-site
  [/\bhow\s*old\s*(?:r|are|is)\s*(?:u|you|ya|yall)\b|\b(?:ur|your|yur)\s*age\b|\bwhat\s*age\s*(?:r|are)\b|\basl\b|\bage\s*sex\s*location\b|\bwhere\s*(?:do|d|does)\s*(?:u|you|ya)\s*(?:live|stay)\b|\bwhere\s*(?:r|are)\s*(?:u|you|ya)\s*from\b|\bwhere\s*u\s*live\b|\b(?:ur|your|my)\s*(?:address|addy|real\s*name|phone|number|zip\s*code)\b|\bwhat\s*(?:school|grade|city|state|town)\s*(?:do|are|r|is)\b|\bwhat\s*(?:grade|school)\s*(?:u|you)\b|\bmeet\s*(?:me\s*|up\s*)?(?:irl|in\s*real\s*life|in\s*person)\b|\bi\s*live\s*(?:in|at|on|near)\b/, "personal"],
  [/\b(?:dm|pm|text|txt|msg|message|whatsapp|snap|sc|facetime)\s*me\b|\bhmu\b|\bhit\s*me\s*up\b/, "personal"],
  // strong platform names: any mention is an off-site contact attempt in a kids' game
  [/\b(?:snapchat|instagram|insta|discord|tiktok|tik\s*tok|whatsapp|whats\s*app|telegram|kik|facebook|twitter|skype|wechat|onlyfans|omegle|reddit)\b/, "personal"],
  // weak platform names only with a contact verb / possessive
  [/\b(?:add|follow|friend|find|dm|msg|message|join|hmu)\s*(?:me\s*)?(?:on|at|in)?\s*(?:snap|sc|ig|fb|yt|youtube|twitch|roblox|xbox|psn|steam|fortnite|minecraft)\b|\b(?:my|ur|your|whats?\s*(?:ur|your)?|what\s*is\s*(?:ur|your))\s*(?:snap|sc|ig|fb|yt|youtube|twitch|roblox|xbox|psn|steam)\b|\b(?:snap|ig|roblox|xbox|psn|steam|yt|twitch)\s*(?:name|username|user|id|tag|handle|gamertag)\b/, "personal"],
];

/** Run over the NON-leet view (digits stay digits), whitespace kept. */
const PII_RULES: Array<[RegExp, DropCategory]> = [
  [/[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\{at\})\s*[a-z0-9-]+\s*(?:\.|\(dot\)|\[dot\]|\{dot\}|\sdot\s)\s*[a-z]{2,}/, "email"],
  [/https?\s*:|\bhttps?\b|\bwww\s*\.|\bwww\b|:\/\/|\b[a-z0-9-]{1,63}\.(?:com|net|org|gg|io|co|tv|me|ly|xyz|us|uk|ru|app|link|info|biz|tk|ca|de|fr|live|site|online|club|gl|be|to|cc|ws)\b|\b[a-z0-9-]{1,63}\s*(?:\s\.\s*|\(dot\)|\[dot\]|\{dot\}|\sdot\s)\s*(?:com|net|org|gg|io|tv|xyz|ru)\b|\bdiscord\s*(?:\.?\s*gg|app)\b|\bdot\s*com\b|\bbit\s*\.?\s*ly\b/, "link"],
  [/(?<![\d,.])(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\d,])|(?<![\d,.$])\d{3}[\s.-]\d{4}(?![\d,.])|\+\d[\d\s.-]{8,}\d/, "phone"],
  [/\b\d{1,5}\s+[a-z]+(?:\s+[a-z]+)?\s+(?:st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|ct|court|way|pl|place|terrace|cir|circle)\b/, "personal"],
  [/\b\d{1,2}\s*(?:years?|yrs?|yr)\s*old\b|\b\d{1,2}\s*y\/?o\b/, "personal"],
  [/\b14\s*88\b/, "slur"],
];

/** Run over the leet view with ALL separators removed. */
const SQUASHED_RULES: Array<[RegExp, DropCategory]> = [
  [/kill(?:your|ur|yo)sel(?:f|ves)|hang(?:your|ur)self|neck(?:your|ur)self/, "threat"],
  [/howold(?:are|r)(?:you|u|ya)|where(?:do|d)?(?:you|u)live|snapme|addmeon(?:snap|insta|discord|ig|roblox)|whatsyour(?:snap|insta|discord|number)/, "personal"],
];

// ---------------------------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------------------------

/** Positions [start, end) in `s` covered by SAFE_TERMS. */
function safeSpans(s: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const term of SAFE_TERMS) {
    let from = 0;
    for (let k = s.indexOf(term, from); k >= 0; k = s.indexOf(term, from)) {
      spans.push([k, k + term.length]);
      from = k + 1;
    }
  }
  return spans;
}

/**
 * Classify `text` (already sanitized). Returns allow, mask (mild words starred, same length, everything
 * else untouched) or drop (with a category for logging; the text is never logged).
 */
export function moderateText(text: string): ModerationResult {
  if (!text) return { action: "allow" };

  // Child-safety: links / emails / phones / street addresses on the non-leet view.
  const plain = buildView(text, false).s.replace(/\s+/g, " ");
  for (const [re, cat] of PII_RULES) if (re.test(plain)) return { action: "drop", category: cat };

  const view = joinSpacedRuns(buildView(text, true));

  // Phrase rules on the leet view with punctuation flattened to spaces.
  const words = view.s.replace(/[^a-z0-9]+/g, " ");
  for (const [re, cat] of PHRASE_RULES) if (re.test(words)) return { action: "drop", category: cat };
  // Also catch run-together phrases ("killyourself", "howoldru") on a no-space form.
  const squashed = words.replace(/ /g, "");
  for (const [re, cat] of SQUASHED_RULES) if (re.test(squashed)) return { action: "drop", category: cat };

  // Word matcher.
  const matches = MATCHER.getAllMatches(view.s, true);
  if (matches.length === 0) return { action: "allow" };
  const safe = safeSpans(view.s);
  const mild: Array<[number, number]> = [];
  for (const m of matches) {
    const end = m.endIndex + 1;
    if (safe.some(([a, b]) => m.startIndex >= a && end <= b)) continue;
    const word = DATASET.getPayloadWithPhraseMetadata(m).phraseMetadata?.originalWord ?? "";
    const severe = SEVERE_WORDS[word];
    if (severe) return { action: "drop", category: severe };
    // Widen to the whole word ("a$$hole", "fucking"), as the old mask did.
    let a = m.startIndex;
    let b = end;
    while (a > 0 && /[a-z0-9]/.test(view.s[a - 1])) a--;
    while (b < view.s.length && /[a-z0-9]/.test(view.s[b])) b++;
    mild.push([a, b]);
  }
  if (mild.length === 0) return { action: "allow" };

  // Mask: every non-space code unit range in the original covered by a mild match.
  const hide = new Uint8Array(text.length);
  for (const [a, b] of mild) {
    const start = view.map[a][0];
    const stop = view.map[b - 1][1];
    for (let k = start; k < stop; k++) hide[k] = 1;
  }
  let out = "";
  for (let k = 0; k < text.length; ) {
    const cp = String.fromCodePoint(text.codePointAt(k)!);
    // Combining marks inside a hidden word are dropped; letters, digits and symbols become "*".
    if (hide[k] && /\p{M}/u.test(cp)) {
      k += cp.length;
      continue;
    }
    out += hide[k] && /[\p{L}\p{N}\p{S}@$!|+*]/u.test(cp) ? "*" : cp;
    k += cp.length;
  }
  return { action: "mask", text: out };
}

/** Ship names: anything that would not chat cleanly (mild, severe or personal info) is refused. */
export function isNameAllowed(name: string): boolean {
  return moderateText(name).action === "allow";
}
