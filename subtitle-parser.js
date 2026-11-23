const timeToSeconds = (value) => {
  const parts = value.trim().replace(',', '.').split(':').map(Number);
  if (parts.some(part => !Number.isFinite(part)) || parts.length < 2 || parts.length > 3) return NaN;
  return parts.reduce((total, part) => total * 60 + part, 0);
};

const splitFields = (value, count) => {
  const fields = [];
  let remainder = value;
  for (let index = 1; index < count; index++) {
    const comma = remainder.indexOf(',');
    if (comma < 0) return [];
    fields.push(remainder.slice(0, comma).trim());
    remainder = remainder.slice(comma + 1);
  }
  fields.push(remainder.trim());
  return fields;
};

const assColorToCss = (value) => {
  const match = /&H(?:[0-9a-f]{2})?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})&?/i.exec(value || '');
  return match ? `#${match[3]}${match[2]}${match[1]}` : null;
};

export const parseVtt = (source) => {
  const cues = [];
  let currentCue = null;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.includes('-->')) {
      if (currentCue) cues.push(currentCue);
      const [start, end] = line.split('-->');
      currentCue = {
        startSec: timeToSeconds(start.split(' ')[0]),
        endSec: timeToSeconds(end.trim().split(' ')[0]),
        text: '',
        format: 'vtt'
      };
    } else if (currentCue && line) {
      currentCue.text += (currentCue.text ? '\n' : '') + line;
    }
  }
  if (currentCue) cues.push(currentCue);
  return cues.filter(cue => Number.isFinite(cue.startSec) && Number.isFinite(cue.endSec) && cue.endSec > cue.startSec)
    .sort((a, b) => a.startSec - b.startSec);
};

export const parseAss = (source) => {
  const cues = [];
  const styles = new Map();
  let section = '';
  let styleFields = [];
  let eventFields = [];
  let playResX = 384;
  let playResY = 288;

  for (const rawLine of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('[')) {
      section = line.toLowerCase();
      continue;
    }
    if (section === '[script info]') {
      const x = /^PlayResX:\s*(\d+)/i.exec(line);
      const y = /^PlayResY:\s*(\d+)/i.exec(line);
      if (x && Number(x[1]) > 0) playResX = Number(x[1]);
      if (y && Number(y[1]) > 0) playResY = Number(y[1]);
      continue;
    }
    if (section === '[v4+ styles]' || section === '[v4 styles]') {
      if (/^Format:/i.test(line)) {
        styleFields = line.slice(line.indexOf(':') + 1).split(',').map(field => field.trim().toLowerCase());
      } else if (/^Style:/i.test(line) && styleFields.length) {
        const values = splitFields(line.slice(line.indexOf(':') + 1).trim(), styleFields.length);
        if (values.length) {
          const style = Object.fromEntries(styleFields.map((field, index) => [field, values[index]]));
          styles.set(style.name, style);
        }
      }
      continue;
    }
    if (section !== '[events]') continue;
    if (/^Format:/i.test(line)) {
      eventFields = line.slice(line.indexOf(':') + 1).split(',').map(field => field.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue:/i.test(line) || !eventFields.length) continue;

    const values = splitFields(line.slice(line.indexOf(':') + 1).trim(), eventFields.length);
    if (!values.length) continue;
    const event = Object.fromEntries(eventFields.map((field, index) => [field, values[index]]));
    const startSec = timeToSeconds(event.start);
    const endSec = timeToSeconds(event.end);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) continue;

    const style = styles.get(event.style) || styles.get('Default') || {};
    const tags = [...event.text.matchAll(/\{([^}]*)\}/g)].map(match => match[1]).join('');
    const alignment = Number(/\\an([1-9])/.exec(tags)?.[1] || style.alignment || 2);
    const positionMatch = /\\pos\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/i.exec(tags);
    const fontSize = Number(/\\fs([\d.]+)/i.exec(tags)?.[1] || style.fontsize || 0);
    const text = event.text.replace(/\{[^}]*\}/g, '')
      .replace(/\\N/g, '\n').replace(/\\n/g, ' ').replace(/\\h/g, '\u00a0');

    cues.push({
      startSec,
      endSec,
      text,
      format: 'ass',
      layer: Number(event.layer) || 0,
      alignment: alignment >= 1 && alignment <= 9 ? alignment : 2,
      marginL: Number(event.marginl) || Number(style.marginl) || 0,
      marginR: Number(event.marginr) || Number(style.marginr) || 0,
      marginV: Number(event.marginv) || Number(style.marginv) || 0,
      position: positionMatch ? { x: Number(positionMatch[1]), y: Number(positionMatch[2]) } : null,
      fontSize,
      fontFamily: style.fontname || '',
      color: assColorToCss(style.primarycolour),
      playResX,
      playResY
    });
  }
  return cues.sort((a, b) => a.startSec - b.startSec || a.layer - b.layer);
};

export const activeCues = (track, time) => track.filter(cue => cue.startSec <= time && time < cue.endSec && cue.text);

export const nextSubtitleBoundary = (tracks, time) => {
  let next = null;
  for (const track of tracks) {
    for (const cue of track) {
      for (const boundary of [cue.startSec, cue.endSec]) {
        if (boundary > time && (next === null || boundary < next)) next = boundary;
      }
    }
  }
  return next;
};
