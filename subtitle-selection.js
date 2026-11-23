const languageCodeAliases = {
  chi: 'zh', zho: 'zh',
  dut: 'nl', nld: 'nl',
  eng: 'en',
  fre: 'fr', fra: 'fr',
  ger: 'de', deu: 'de',
  ita: 'it', jpn: 'ja', kor: 'ko',
  por: 'pt', rus: 'ru', spa: 'es'
};

export const normalizeLanguageCode = (code) => {
  const normalized = (code || '').trim().toLowerCase().split(/[-_]/)[0];
  if (!normalized || normalized === 'und') return null;
  return languageCodeAliases[normalized] || normalized;
};

const learningLanguages = new Set(['de', 'en', 'fr', 'es', 'it', 'ja', 'ko', 'pt', 'ru', 'nl', 'zh']);

export const resolveLearningLanguage = (saved) => {
  const language = normalizeLanguageCode(saved);
  return learningLanguages.has(language) ? language : 'de';
};

export const selectAudioTrackId = (streams, learningLanguage, currentId) => {
  const language = normalizeLanguageCode(learningLanguage);
  const match = language ? streams.find(stream => normalizeLanguageCode(stream.langCode) === language) : null;
  return (match ?? streams.find(stream => stream.id === currentId) ?? streams[0])?.id ?? '';
};

export const selectTopSubtitleId = (streams, audioLanguage) => {
  const language = normalizeLanguageCode(audioLanguage);
  const matches = language ? streams.filter(stream => normalizeLanguageCode(stream.langCode) === language) : [];
  const dubTitlePattern = /(?:^|[^a-z])dub(?:bed|bing|s|[\s_-]*titles?)?(?=$|[^a-z])/i;
  return (matches.find(stream => dubTitlePattern.test(stream.title || '')) ?? matches[0] ?? streams[0])?.id ?? 'none';
};

export const selectBottomSubtitleId = (streams, topId, interfaceLanguage) =>
  streams.find(stream => stream.id !== topId && normalizeLanguageCode(stream.langCode) === interfaceLanguage)?.id ?? 'none';
