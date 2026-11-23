export const chooseSubtitleTop = (plainBoxes, obstacles, minTop, maxTop, gap = 10) => {
  if (maxTop <= minTop) return minTop;

  const candidates = [maxTop, minTop];
  for (const obstacle of obstacles) {
    for (const box of plainBoxes) {
      candidates.push(
        obstacle.top - box.bottomOffset - gap,
        obstacle.bottom - box.topOffset + gap
      );
    }
  }

  let chosenTop = maxTop;
  let smallestOverlap = Infinity;
  for (const top of candidates.filter(value => value >= minTop && value <= maxTop).sort((a, b) => b - a)) {
    let overlap = 0;
    for (const box of plainBoxes) {
      const boxTop = top + box.topOffset;
      const boxBottom = top + box.bottomOffset;
      for (const obstacle of obstacles) {
        const width = Math.max(0, Math.min(box.right, obstacle.right) - Math.max(box.left, obstacle.left));
        const height = Math.max(0, Math.min(boxBottom, obstacle.bottom) - Math.max(boxTop, obstacle.top));
        overlap += width * height;
      }
    }
    if (overlap < smallestOverlap) {
      smallestOverlap = overlap;
      chosenTop = top;
      if (overlap === 0) break;
    }
  }
  return chosenTop;
};

export const chooseTooltipPosition = (word, container, tooltipWidth, tooltipHeight, gap = 8) => {
  const left = Math.max(gap, Math.min(
    word.left - container.left + (word.width - tooltipWidth) / 2,
    container.width - tooltipWidth - gap
  ));
  const above = word.top - container.top - tooltipHeight - gap;
  const below = word.bottom - container.top + gap;
  const top = above >= gap ? above
    : below + tooltipHeight <= container.height - gap ? below
      : Math.max(gap, Math.min(below, container.height - tooltipHeight - gap));
  return { left, top };
};

export const scaledAssFontSize = (fontSize, playResY, displayHeight, percent) =>
  Math.max(8, displayHeight * (fontSize || 24) / playResY * percent / 100);

export const assAnchorPercent = (cue) => {
  const column = (cue.alignment - 1) % 3;
  const row = Math.floor((cue.alignment - 1) / 3);
  const x = cue.position
    ? cue.position.x
    : column === 0 ? cue.marginL
      : column === 2 ? cue.playResX - cue.marginR
        : (cue.playResX + cue.marginL - cue.marginR) / 2;
  const y = cue.position
    ? cue.position.y
    : row === 0 ? cue.playResY - cue.marginV
      : row === 2 ? cue.marginV : cue.playResY / 2;

  return { column, row, left: x / cue.playResX * 100, top: y / cue.playResY * 100 };
};
