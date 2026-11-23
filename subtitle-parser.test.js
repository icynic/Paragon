import assert from 'node:assert/strict';
import test from 'node:test';
import { activeCues, nextSubtitleBoundary, parseAss, parseVtt } from './subtitle-parser.js';

test('ASS keeps concurrent lines and their independent placements', () => {
  const cues = parseAss(`[Script Info]
PlayResX: 1280
PlayResY: 720

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, Alignment, MarginL, MarginR, MarginV
Style: Bottom, Arial, 48, &H00FFFFFF, 2, 15, 15, 20
Style: Top, Arial, 42, &H00FFFFFF, 8, 15, 15, 20

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:04.00,Bottom,,0,0,0,,First speaker
Dialogue: 0,0:00:02.00,0:00:05.00,Top,,0,0,0,,Second speaker
Dialogue: 1,0:00:02.50,0:00:03.50,Bottom,,0,0,0,,{\\pos(300,200)}Sign\\Ntext
`);

  assert.equal(cues.length, 3);
  assert.deepEqual(activeCues(cues, 2.75).map(cue => cue.text),
    ['First speaker', 'Second speaker', 'Sign\ntext']);
  assert.deepEqual(activeCues(cues, 2.75).map(cue => cue.alignment), [2, 8, 2]);
  assert.deepEqual(cues[2].position, { x: 300, y: 200 });
  assert.equal(nextSubtitleBoundary([cues], 2.75), 3.5);
  assert.deepEqual(activeCues(cues, 3.75).map(cue => cue.text),
    ['First speaker', 'Second speaker']);
});

test('VTT also keeps overlapping cues and each end boundary', () => {
  const cues = parseVtt(`WEBVTT

00:00:01.000 --> 00:00:03.000
One

00:00:02.000 --> 00:00:04.000
Two
`);
  assert.deepEqual(activeCues(cues, 2.5).map(cue => cue.text), ['One', 'Two']);
  assert.equal(nextSubtitleBoundary([cues], 2.5), 3);
  assert.deepEqual(activeCues(cues, 3.5).map(cue => cue.text), ['Two']);
});
