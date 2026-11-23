import assert from 'node:assert/strict';
import test from 'node:test';
import { assAnchorPercent, chooseSubtitleTop, chooseTooltipPosition, scaledAssFontSize } from './subtitle-layout.js';

const germanLine = [{ left: 200, right: 800, topOffset: 0, bottomOffset: 40 }];

test('moves ordinary subtitle above an overlapping bottom ASS line', () => {
  const chineseAss = [{ left: 250, right: 750, top: 600, bottom: 680 }];
  assert.equal(chooseSubtitleTop(germanLine, chineseAss, 10, 660), 550);
});

test('uses the space between top and bottom ASS lines', () => {
  const assLines = [
    { left: 250, right: 750, top: 20, bottom: 90 },
    { left: 250, right: 750, top: 600, bottom: 680 }
  ];
  assert.equal(chooseSubtitleTop(germanLine, assLines, 10, 660), 550);
});

test('does not move a subtitle for an ASS line in a different horizontal region', () => {
  const sideNote = [{ left: 10, right: 150, top: 600, bottom: 680 }];
  assert.equal(chooseSubtitleTop(germanLine, sideNote, 10, 660), 660);
});

test('puts top-line lookup tooltip below the word and clamps it inside the player', () => {
  const container = { left: 100, top: 100, width: 800, height: 450 };
  const word = { left: 110, top: 115, right: 150, bottom: 135, width: 40 };
  assert.deepEqual(chooseTooltipPosition(word, container, 200, 60), { left: 8, top: 43 });
});

test('puts bottom-line lookup tooltip above the word', () => {
  const container = { left: 100, top: 100, width: 800, height: 450 };
  const word = { left: 480, top: 480, right: 520, bottom: 500, width: 40 };
  assert.deepEqual(chooseTooltipPosition(word, container, 200, 60), { left: 300, top: 312 });
});

test('scales ASS text by the selected track percentage', () => {
  assert.equal(scaledAssFontSize(48, 720, 720, 50), 24);
  assert.equal(scaledAssFontSize(48, 720, 720, 100), 48);
  assert.equal(scaledAssFontSize(48, 720, 720, 150), 72);
});

test('centers simultaneous ASS lines within their asymmetric margins', () => {
  const base = { alignment: 2, playResX: 1280, playResY: 720, marginV: 15, position: null };
  const leftSpeaker = assAnchorPercent({ ...base, marginL: 15, marginR: 400 });
  const rightSpeaker = assAnchorPercent({ ...base, marginL: 400, marginR: 15 });

  assert.equal(leftSpeaker.left, 447.5 / 1280 * 100);
  assert.equal(rightSpeaker.left, 832.5 / 1280 * 100);
  assert.equal(leftSpeaker.top, rightSpeaker.top);
});

test('explicit ASS position overrides style margins', () => {
  const anchor = assAnchorPercent({
    alignment: 8, playResX: 1280, playResY: 720,
    marginL: 400, marginR: 15, marginV: 15,
    position: { x: 300, y: 200 }
  });
  assert.equal(anchor.left, 300 / 1280 * 100);
  assert.equal(anchor.top, 200 / 720 * 100);
});
