import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveInterfaceLanguage, translate } from './i18n.js';
import { resolveLearningLanguage, selectAudioTrackId, selectBottomSubtitleId, selectTopSubtitleId } from './subtitle-selection.js';

const streams = [
  { id: 'de-full', langCode: 'ger', title: 'German Full' },
  { id: 'fr', langCode: 'fra', title: 'French' },
  { id: 'en', langCode: 'eng', title: 'English' },
  { id: 'zh', langCode: 'chi', title: '简体中文' },
  { id: 'de-dub', langCode: 'deu', title: 'German_Dubtitles' }
];

test('German audio selects dubtitles while the interface selects the bottom language', () => {
  const top = selectTopSubtitleId(streams, 'de-DE');
  assert.equal(top, 'de-dub');
  assert.equal(selectBottomSubtitleId(streams, top, 'zh'), 'zh');
  assert.equal(selectBottomSubtitleId(streams, top, 'en'), 'en');
});

test('dub priority never selects a subtitle in a different audio language', () => {
  assert.equal(selectTopSubtitleId(streams, 'en'), 'en');
  assert.equal(selectTopSubtitleId(streams, 'ja'), 'de-full');
});

test('bottom selection does not fall back to unrelated languages or duplicate the top track', () => {
  assert.equal(selectBottomSubtitleId(streams.filter(stream => stream.id !== 'zh'), 'de-dub', 'zh'), 'none');
  assert.equal(selectBottomSubtitleId(streams, 'en', 'en'), 'none');
  assert.equal(selectBottomSubtitleId([...streams, { id: 'en-other', langCode: 'en_US' }], 'en', 'en'), 'en-other');
  assert.equal(selectTopSubtitleId([], 'de'), 'none');
});

test('saved interface language takes precedence over browser language', () => {
  assert.equal(resolveInterfaceLanguage('en', 'zh-CN'), 'en');
  assert.equal(resolveInterfaceLanguage('zh', 'en-US'), 'zh');
  assert.equal(resolveInterfaceLanguage(null, 'zh-TW'), 'zh');
  assert.equal(resolveInterfaceLanguage('invalid', 'fr-FR'), 'en');
  assert.equal(translate('zh', 'noDefinitions', { word: 'Hallo' }), '维基词典中未找到“Hallo”的释义。');
});

test('remembered learning language selects audio before selecting its dub subtitle', () => {
  const audio = [{ id: 'audio-en', langCode: 'eng' }, { id: 'audio-de', langCode: 'ger' }];
  const language = resolveLearningLanguage('de-DE');
  const audioId = selectAudioTrackId(audio, language, 'audio-en');
  assert.equal(audioId, 'audio-de');
  assert.equal(selectTopSubtitleId(streams, audio.find(stream => stream.id === audioId).langCode), 'de-dub');
  assert.equal(selectBottomSubtitleId(streams, 'de-dub', 'zh'), 'zh');
});

test('missing learning audio keeps an available track instead of selecting an invalid stream', () => {
  const audio = [{ id: 'audio-en', langCode: 'eng' }, { id: 'audio-de', langCode: 'ger' }];
  assert.equal(selectAudioTrackId(audio, 'ja', 'audio-de'), 'audio-de');
  assert.equal(selectAudioTrackId(audio, 'ja', 'old-file-track'), 'audio-en');
  assert.equal(selectAudioTrackId([audio[0]], 'de', 'audio-en'), 'audio-en');
  assert.equal(selectAudioTrackId([], 'de', ''), '');
});

test('learning language preference is independent from interface language', () => {
  assert.equal(resolveLearningLanguage('en'), 'en');
  assert.equal(resolveLearningLanguage('jpn'), 'ja');
  assert.equal(resolveLearningLanguage(null), 'de');
  assert.equal(resolveLearningLanguage('invalid'), 'de');
  assert.equal(resolveInterfaceLanguage('zh', 'en-US'), 'zh');
});
