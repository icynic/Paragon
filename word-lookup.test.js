import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanWord,
  definitionLookupCandidates,
  definitionsForLanguage,
  lookupLanguagePair,
  parseMyMemoryResponse,
  segmentWords
} from './word-lookup.js';

const words = (text, lang) => segmentWords(text, lang).filter(s => s.isWord).map(s => s.text);

test('segmentWords splits languages without spaces into words', () => {
  assert.deepEqual(words('我今天去学校了。', 'zh'), ['我', '今天', '去', '学校', '了']);
  assert.ok(words('今日は学校に行きました。', 'ja').includes('学校'));
});

test('segmentWords keeps apostrophes and hyphenated compounds inside words', () => {
  assert.deepEqual(words("Je lis l'homme et mon E-Mail.", 'fr'), ['Je', 'lis', "l'homme", 'et', 'mon', 'E-Mail']);
});

test('segmentWords round-trips the original text, including line breaks', () => {
  const text = 'Er ging nach Hause.\nGut so!';
  assert.equal(segmentWords(text, 'de').map(s => s.text).join(''), text);
  assert.deepEqual(words(text, 'de'), ['Er', 'ging', 'nach', 'Hause', 'Gut', 'so']);
});

test('segmentWords tolerates missing or invalid language codes', () => {
  assert.deepEqual(words('hello world', ''), ['hello', 'world']);
  assert.deepEqual(words('hello world', 'not a locale!'), ['hello', 'world']);
});

test('cleanWord trims only surrounding punctuation', () => {
  assert.equal(cleanWord('«aujourd’hui»,'), 'aujourd’hui');
  assert.equal(cleanWord("l'homme!"), "l'homme");
  assert.equal(cleanWord('(E-Mail)'), 'E-Mail');
  assert.equal(cleanWord('…'), '');
});

test('lookupLanguagePair follows the interactive track', () => {
  assert.deepEqual(lookupLanguagePair('top', 'de', 'zh'), { from: 'de', to: 'zh' });
  assert.deepEqual(lookupLanguagePair('bottom', 'de', 'zh'), { from: 'zh', to: 'de' });
  assert.equal(lookupLanguagePair('top', '', 'zh'), null);
  assert.equal(lookupLanguagePair('top', 'de', 'de'), null);
});

test('parseMyMemoryResponse rejects quota warnings returned with HTTP 200', () => {
  assert.deepEqual(parseMyMemoryResponse({ responseStatus: 200, responseData: { translatedText: '手' } }), { ok: true, translation: '手' });
  assert.equal(parseMyMemoryResponse({
    responseStatus: 429,
    responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY.' }
  }).ok, false);
  assert.equal(parseMyMemoryResponse({
    responseStatus: '200',
    responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY.' }
  }).ok, false);
  assert.equal(parseMyMemoryResponse(null).ok, false);
});

test('definitionsForLanguage keeps only the looked-up language', () => {
  const data = { en: [{ partOfSpeech: 'Noun' }], de: [{ partOfSpeech: 'Substantiv' }] };
  assert.deepEqual(definitionsForLanguage(data, 'de'), [{ partOfSpeech: 'Substantiv' }]);
  assert.equal(definitionsForLanguage(data, 'fr'), null);
});

test('definitionLookupCandidates falls back to lowercase', () => {
  assert.deepEqual(definitionLookupCandidates('Die'), ['Die', 'die']);
  assert.deepEqual(definitionLookupCandidates('die'), ['die']);
});
