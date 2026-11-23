// Pure helpers for subtitle word splitting and dictionary/translation lookups.

const HYPHENS = new Set(['-', '‐', '‑']);

const createSegmenter = (lang) => {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;
  try {
    return new Intl.Segmenter(lang || undefined, { granularity: 'word' });
  } catch {
    return new Intl.Segmenter(undefined, { granularity: 'word' });
  }
};

// Split subtitle text into { text, isWord } segments that concatenate back to the
// original text. Uses Intl.Segmenter so languages without spaces (Chinese,
// Japanese) are split into words; hyphenated compounds like "E-Mail" stay whole.
export const segmentWords = (text, lang) => {
  const segmenter = createSegmenter(lang);
  const raw = segmenter
    ? [...segmenter.segment(text)].map(({ segment, isWordLike }) => ({ text: segment, isWord: Boolean(isWordLike) }))
    : text.split(/(\s+)/).filter(Boolean).map(part => ({ text: part, isWord: !/^\s+$/.test(part) }));

  const segments = [];
  for (let i = 0; i < raw.length; i++) {
    const previous = segments[segments.length - 1];
    const hyphen = raw[i];
    const next = raw[i + 1];
    if (previous?.isWord && HYPHENS.has(hyphen.text) && next?.isWord) {
      previous.text += hyphen.text + next.text;
      i++;
    } else {
      segments.push({ ...hyphen });
    }
  }
  return segments;
};

// Trim punctuation from the ends of a word while keeping inner apostrophes and
// hyphens ("l'homme", "aujourd'hui", "E-Mail").
export const cleanWord = (word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

// The interactive track decides the lookup direction: words on the top subtitle
// translate top -> bottom language, words on the bottom subtitle the reverse.
export const lookupLanguagePair = (track, topLanguage, bottomLanguage) => {
  const [from, to] = track === 'bottom' ? [bottomLanguage, topLanguage] : [topLanguage, bottomLanguage];
  if (!from || !to || from === to) return null;
  return { from, to };
};

// MyMemory reports quota and other errors with HTTP 200 and puts the error
// message in translatedText, so check responseStatus and the warning prefix.
export const parseMyMemoryResponse = (data) => {
  const status = Number(data?.responseStatus);
  const text = data?.responseData?.translatedText;
  if (status !== 200 || typeof text !== 'string' || !text.trim()) return { ok: false, translation: null };
  if (/^MYMEMORY WARNING/i.test(text) || /^(INVALID|QUERY LENGTH LIMIT)/i.test(text)) {
    return { ok: false, translation: null };
  }
  return { ok: true, translation: text.trim() };
};

// Wiktionary's REST definition endpoint groups entries by language code; keep
// only the entries for the language being looked up.
export const definitionsForLanguage = (data, lang) => {
  const entries = data?.[lang];
  return Array.isArray(entries) && entries.length ? entries : null;
};

// Page titles to try on Wiktionary: the word as written, then lowercased for
// sentence-initial capitals ("Die" -> "die").
export const definitionLookupCandidates = (word) => {
  const lower = word.toLowerCase();
  return lower === word ? [word] : [word, lower];
};
