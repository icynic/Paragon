import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { activeCues, nextSubtitleBoundary, parseAss, parseVtt } from './subtitle-parser.js';
import { assAnchorPercent, chooseSubtitleTop, chooseTooltipPosition, scaledAssFontSize } from './subtitle-layout.js';
import { resolveInterfaceLanguage, translate } from './i18n.js';
import { normalizeLanguageCode, resolveLearningLanguage, selectAudioTrackId, selectBottomSubtitleId, selectTopSubtitleId } from './subtitle-selection.js';
import { cleanWord, definitionLookupCandidates, definitionsForLanguage, lookupLanguagePair, parseMyMemoryResponse, segmentWords } from './word-lookup.js';

const ffmpeg = new FFmpeg();
let videoFile = null;
let playbackVideoFile = null;
let loadedAudioTrackId = '';
let loadedBottomSubtitleId = 'none';
let parsedTopSubtitle = [];
let parsedBottomSubtitle = [];

let videoStreams = [];
let audioStreams = [];
let subStreams = [];
let inputVideoPath = 'input.mkv';

const ui = {
  learningLanguage: document.getElementById('learningLanguage'),
  languageToggle: document.getElementById('languageToggle'),
  languageStatus: document.getElementById('languageStatus'),
  mkvInput: document.getElementById('mkvInput'),
  fileNameDisplay: document.getElementById('fileNameDisplay'),
  loadingStatus: document.getElementById('loadingStatus'),
  configSection: document.getElementById('configSection'),
  audioTrack: document.getElementById('audioTrack'),
  topSubtitleTrack: document.getElementById('topSubtitleTrack'),
  bottomSubtitleTrack: document.getElementById('bottomSubtitleTrack'),
  loadVideoBtn: document.getElementById('loadVideoBtn'),
  extractionStatus: document.getElementById('extractionStatus'),
  playerSection: document.getElementById('playerSection'),
  videoPlayer: document.getElementById('videoPlayer'),
  subtitlesOverlay: document.getElementById('subtitlesOverlay'),
  topSubtitle: document.getElementById('topSubtitle'),
  bottomSubtitle: document.getElementById('bottomSubtitle'),
  assSubtitleLayer: document.getElementById('assSubtitleLayer'),
  subtitleSettingsPanel: document.getElementById('subtitleSettingsPanel'),
  subtitleSettingsBtn: document.getElementById('subtitleSettingsBtn'),
  topSubtitleSize: document.getElementById('topSubtitleSize'),
  topSubtitleSizeValue: document.getElementById('topSubtitleSizeValue'),
  bottomSubtitleSize: document.getElementById('bottomSubtitleSize'),
  bottomSubtitleSizeValue: document.getElementById('bottomSubtitleSizeValue'),
  prevCaptionBtn: document.getElementById('prevCaptionBtn'),
  nextCaptionBtn: document.getElementById('nextCaptionBtn'),
  playbackSpeed: document.getElementById('playbackSpeed'),
  fullscreenBtn: document.getElementById('fullscreenBtn'),
  videoContainer: document.getElementById('videoContainer'),
  controlsPanel: document.getElementById('controlsPanel'),
  playPauseBtn: document.getElementById('playPauseBtn'),
  progressBar: document.getElementById('progressBar'),
  volumeBar: document.getElementById('volumeBar'),
  currentTimeDisplay: document.getElementById('currentTimeDisplay'),
  durationDisplay: document.getElementById('durationDisplay'),
  sourceLang: document.getElementById('sourceLang'),
  targetLang: document.getElementById('targetLang'),
  hoverTooltip: document.getElementById('hoverTooltip'),
  definitionPanel: document.getElementById('definitionPanel'),
  defPanelClose: document.getElementById('defPanelClose'),
  defPanelContent: document.getElementById('defPanelContent'),
  translationTrack: document.getElementById('translationTrack'),
  navigationTrack: document.getElementById('navigationTrack')
};

let savedInterfaceLanguage = null;
let savedLearningLanguage = null;
try {
  savedInterfaceLanguage = localStorage.getItem('paragon.interfaceLanguage');
  savedLearningLanguage = localStorage.getItem('paragon.learningLanguage');
} catch (error) {
  console.warn('Interface language preference unavailable', error);
}
let interfaceLanguage = resolveInterfaceLanguage(savedInterfaceLanguage, navigator.language);
let learningLanguage = resolveLearningLanguage(savedLearningLanguage);
ui.learningLanguage.value = learningLanguage;
const t = (key, values) => translate(interfaceLanguage, key, values);
const setLocalizedText = (element, key, values) => {
  element.dataset.i18n = key;
  element.textContent = t(key, values);
};

const setMediaBusy = (busy) => {
  for (const element of [ui.learningLanguage, ui.languageToggle, ui.mkvInput, ui.loadVideoBtn,
    ui.audioTrack, ui.topSubtitleTrack, ui.bottomSubtitleTrack]) element.disabled = busy;
};

const readSubtitleSize = (track) => {
  try {
    const saved = localStorage.getItem(`paragon.subtitleSize.${track}`);
    const size = Number(saved);
    if (saved !== null && Number.isFinite(size)) {
      return Math.max(50, Math.min(150, Math.round(size / 5) * 5));
    }
  } catch (error) {
    console.warn('Subtitle size preference unavailable', error);
  }
  return 100;
};

const subtitleSize = {
  top: readSubtitleSize('top'),
  bottom: readSubtitleSize('bottom')
};

for (const track of ['top', 'bottom']) {
  const slider = track === 'top' ? ui.topSubtitleSize : ui.bottomSubtitleSize;
  const value = track === 'top' ? ui.topSubtitleSizeValue : ui.bottomSubtitleSizeValue;
  slider.value = String(subtitleSize[track]);
  value.textContent = `${subtitleSize[track]}%`;
  ui.videoContainer.style.setProperty(`--${track}-subtitle-scale`, String(subtitleSize[track] / 100));
  slider.addEventListener('input', () => {
    subtitleSize[track] = Number(slider.value);
    value.textContent = `${subtitleSize[track]}%`;
    ui.videoContainer.style.setProperty(`--${track}-subtitle-scale`, String(subtitleSize[track] / 100));
    try {
      localStorage.setItem(`paragon.subtitleSize.${track}`, String(subtitleSize[track]));
    } catch (error) {
      console.warn('Could not save subtitle size preference', error);
    }
    renderSubtitles(ui.videoPlayer.currentTime);
  });
}

const getFullLanguage = (code) => {
  const normalized = normalizeLanguageCode(code);
  if (!normalized) return t('unknown');
  try {
    return new Intl.DisplayNames([interfaceLanguage], { type: 'language' }).of(normalized);
  } catch(e) {
    return code;
  }
};

const streamLabel = (stream) => {
  const title = stream.title ? ` - ${stream.title}` : '';
  return `[${t('stream')} ${stream.id}] ${getFullLanguage(stream.langCode)}${title} (${stream.details})`;
};

const syncLanguageSelect = (languageSelect, subtitleTrackSelect, { allowManualFallback = false } = {}) => {
  const selectedStream = subStreams.find(stream => stream.id === subtitleTrackSelect.value);
  const enableManualFallback = () => {
    languageSelect.querySelector('option[data-track-language-status]')?.remove();
    languageSelect.disabled = false;
    if (!languageSelect.value) {
      languageSelect.value = languageSelect.querySelector('option[value="zh"]') ? 'zh' : languageSelect.options[0]?.value;
    }
  };
  const setUnavailable = (key) => {
    let statusOption = languageSelect.querySelector('option[data-track-language-status]');
    if (!statusOption) {
      statusOption = document.createElement('option');
      statusOption.value = '';
      statusOption.dataset.trackLanguageStatus = 'true';
      languageSelect.appendChild(statusOption);
    }
    setLocalizedText(statusOption, key);
    languageSelect.value = '';
    languageSelect.disabled = true;
  };

  if (!selectedStream) {
    if (allowManualFallback) enableManualFallback();
    else setUnavailable('noSubtitle');
    return;
  }

  const languageCode = normalizeLanguageCode(selectedStream.langCode);
  if (!languageCode) {
    if (allowManualFallback) enableManualFallback();
    else setUnavailable('unknownSubtitleLanguage');
    return;
  }

  languageSelect.querySelector('option[data-track-language-status]')?.remove();
  languageSelect.disabled = false;

  let option = languageSelect.querySelector(`option[value="${languageCode}"]`);
  if (!option) {
    option = document.createElement('option');
    option.value = languageCode;
    option.textContent = getFullLanguage(selectedStream.langCode);
    languageSelect.appendChild(option);
  }
  languageSelect.value = languageCode;
};

const syncSubtitleLanguages = () => {
  syncLanguageSelect(ui.sourceLang, ui.topSubtitleTrack);
  syncLanguageSelect(ui.targetLang, ui.bottomSubtitleTrack, { allowManualFallback: true });
};

const updateBehaviorTrackOptions = () => {
  const positions = [
    { value: 'top', label: t('topSubtitle'), trackSelect: ui.topSubtitleTrack },
    { value: 'bottom', label: t('bottomSubtitle'), trackSelect: ui.bottomSubtitleTrack }
  ];

  [ui.translationTrack, ui.navigationTrack].forEach(behaviorSelect => {
    positions.forEach(({ value, label, trackSelect }) => {
      const option = behaviorSelect.querySelector(`option[value="${value}"]`);
      const selectedTrack = trackSelect.options[trackSelect.selectedIndex];
      const isAvailable = selectedTrack && selectedTrack.value !== 'none';
      option.disabled = !isAvailable;
      option.textContent = isAvailable
        ? `${label} — ${selectedTrack.textContent}`
        : `${label} — ${t('none')}`;
    });

    const selectedOption = behaviorSelect.options[behaviorSelect.selectedIndex];
    if (!selectedOption || selectedOption.disabled) {
      const firstAvailable = [...behaviorSelect.options].find(option => !option.disabled);
      if (firstAvailable) behaviorSelect.value = firstAvailable.value;
    }
  });

  syncSubtitleLanguages();
};

const selectBottomSubtitleForInterfaceLanguage = () => {
  ui.bottomSubtitleTrack.value = selectBottomSubtitleId(subStreams, ui.topSubtitleTrack.value, interfaceLanguage);
  if (ui.bottomSubtitleTrack.value === 'none') ui.targetLang.value = interfaceLanguage;
  updateBehaviorTrackOptions();
};

const selectSubtitlesForAudioLanguage = () => {
  const selectedAudioStream = audioStreams.find(stream => stream.id === ui.audioTrack.value);
  ui.topSubtitleTrack.value = selectTopSubtitleId(subStreams, selectedAudioStream?.langCode);
  selectBottomSubtitleForInterfaceLanguage();
};

const updateLearningAudioStatus = () => {
  if (audioStreams.length && !audioStreams.some(stream => normalizeLanguageCode(stream.langCode) === learningLanguage)) {
    setLocalizedText(ui.languageStatus, 'noLearningAudio', { language: getFullLanguage(learningLanguage) });
    ui.languageStatus.classList.remove('hidden');
  } else if (ui.languageStatus.dataset.i18n === 'noLearningAudio') {
    ui.languageStatus.classList.add('hidden');
  }
};

const selectAudioForLearningLanguage = ({ forceSubtitleMatch = false } = {}) => {
  const previousId = ui.audioTrack.value;
  ui.audioTrack.value = selectAudioTrackId(audioStreams, learningLanguage, previousId);
  const changed = ui.audioTrack.value !== previousId;
  if (changed || forceSubtitleMatch) selectSubtitlesForAudioLanguage();
  updateLearningAudioStatus();
  return changed;
};

const applyInterfaceLanguage = () => {
  document.documentElement.lang = interfaceLanguage === 'zh' ? 'zh-CN' : 'en';
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n, element.dataset.i18n === 'noLearningAudio'
      ? { language: getFullLanguage(learningLanguage) } : undefined);
  }
  for (const attribute of ['title', 'aria-label']) {
    for (const element of document.querySelectorAll(`[data-i18n-${attribute}]`)) {
      element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
    }
  }
  for (const select of [ui.learningLanguage, ui.sourceLang, ui.targetLang]) {
    for (const option of select.options) {
      if (option.value) option.textContent = getFullLanguage(option.value);
    }
  }
  for (const [select, streams] of [
    [ui.audioTrack, audioStreams], [ui.topSubtitleTrack, subStreams], [ui.bottomSubtitleTrack, subStreams]
  ]) {
    for (const option of select.options) {
      const stream = streams.find(item => item.id === option.value);
      option.textContent = stream ? streamLabel(stream) : t('none');
    }
  }
  updateBehaviorTrackOptions();
};

ui.audioTrack.addEventListener('change', selectSubtitlesForAudioLanguage);
ui.topSubtitleTrack.addEventListener('change', selectBottomSubtitleForInterfaceLanguage);
ui.bottomSubtitleTrack.addEventListener('change', updateBehaviorTrackOptions);

// Translation & Definition Caches
const translationCache = new Map();
const definitionCache = new Map();
let wasPlayingBeforeHover = false;

// Initialize FFmpeg
const initFFmpeg = async () => {
  if (!ffmpeg.loaded) {
    ui.loadingStatus.classList.remove('hidden');
    setLocalizedText(ui.loadingStatus, 'loadingFfmpeg');
    
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    
    ui.loadingStatus.classList.add('hidden');
  }
};

const runFfmpegOutput = async (args, operationName) => {
  const exitCode = await ffmpeg.exec(['-y', ...args]);
  if (exitCode !== 0) {
    throw new Error(`${operationName} failed with FFmpeg exit code ${exitCode}`);
  }
};

const extractSubtitleTrack = async (selection, outputName) => {
  if (selection === 'none') return [];

  const stream = subStreams.find(item => item.id === selection);
  const isAss = /\b(?:ass|ssa)\b/i.test(stream?.details || '');
  const outputPath = `${outputName}.${isAss ? 'ass' : 'vtt'}`;
  const formatArgs = isAss ? ['-c:s', 'ass', '-f', 'ass'] : ['-f', 'webvtt'];
  await runFfmpegOutput(
    ['-i', inputVideoPath, '-map', `0:${selection}`, ...formatArgs, outputPath],
    `${outputName} extraction`
  );
  const data = await ffmpeg.readFile(outputPath);
  const source = new TextDecoder('utf-8').decode(data);
  return isAss ? parseAss(source) : parseVtt(source);
};

const prepareVideoFile = async (file) => {
  videoFile = file;
  ui.fileNameDisplay.removeAttribute('data-i18n');
  ui.fileNameDisplay.textContent = file.name;
  ui.languageStatus.classList.add('hidden');
  
  await initFFmpeg();
  ui.loadingStatus.classList.remove('hidden');
  setLocalizedText(ui.loadingStatus, 'parsingTracks');

  // Try zero-copy mount (WORKERFS) to avoid loading giant movies into memory
  inputVideoPath = 'input.mkv'; // reset
  try {
    await ffmpeg.createDir('/mnt');
  } catch (e) {} // ignore if exists

  try {
    try { await ffmpeg.unmount('/mnt'); } catch (e) {}
    await ffmpeg.mount('WORKERFS', { files: [file] }, '/mnt');
    inputVideoPath = `/mnt/${file.name}`;
  } catch (e) {
    console.warn('WORKERFS mount failed, falling back to in-memory fetchFile', e);
    await ffmpeg.writeFile('input.mkv', await fetchFile(file));
  }

  // Run ffprobe to get streams
  videoStreams = [];
  audioStreams = [];
  subStreams = [];
  let currentStream = null;
  
  // Listen to log to parse ffprobe output
  const logCallback = ({ message }) => {
    const streamMatch = message.match(/Stream #0:(\d+)(?:\[0x[0-9a-f]+\])?(?:\((.*?)\))?: (Video|Audio|Subtitle): (.*)/);
    if (streamMatch) {
      const id = streamMatch[1];
      const langCode = streamMatch[2] || 'und';
      const type = streamMatch[3];
      const streamDetails = streamMatch[4];
      const details = streamDetails.split(',')[0];
      
      currentStream = {
        id,
        langCode,
        type,
        details,
        title: ''
      };
      if (type === 'Video') videoStreams.push(currentStream);
      else if (type === 'Audio') audioStreams.push(currentStream);
      else if (type === 'Subtitle') subStreams.push(currentStream);
    } else if (currentStream && message.includes('title') && message.includes(':')) {
      const titleMatch = message.match(/title\s*:\s*(.*)/);
      if (titleMatch) {
        currentStream.title = titleMatch[1].trim();
      }
    }
  };

  ffmpeg.on('log', logCallback);
  // Run ffmpeg -i to force outputting file info (it will exit with error since no output specified, but we catch logs)
  try {
    await ffmpeg.exec(['-i', inputVideoPath]);
  } catch (err) {}
  ffmpeg.off('log', logCallback);

  // Populate UI
  ui.audioTrack.innerHTML = '';
  audioStreams.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = streamLabel(s);
    ui.audioTrack.appendChild(opt);
  });

  ui.topSubtitleTrack.innerHTML = `<option value="none">${t('none')}</option>`;
  ui.bottomSubtitleTrack.innerHTML = `<option value="none">${t('none')}</option>`;
  subStreams.forEach(s => {
    const topOption = document.createElement('option');
    topOption.value = s.id;
    topOption.textContent = streamLabel(s);
    ui.topSubtitleTrack.appendChild(topOption);

    const bottomOption = topOption.cloneNode(true);
    ui.bottomSubtitleTrack.appendChild(bottomOption);
  });

  ui.translationTrack.value = 'top';
  ui.navigationTrack.value = 'top';
  selectAudioForLearningLanguage({ forceSubtitleMatch: true });

  ui.loadingStatus.classList.add('hidden');
  ui.configSection.classList.remove('hidden');
};

ui.mkvInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  setMediaBusy(true);
  try {
    await prepareVideoFile(file);
  } catch (error) {
    setLocalizedText(ui.loadingStatus, 'videoError');
    ui.loadingStatus.classList.remove('hidden');
    console.error(error);
  } finally {
    setMediaBusy(false);
  }
});

const loadVideoSource = (videoUrl) => new Promise((resolve, reject) => {
  const cleanup = () => {
    ui.videoPlayer.removeEventListener('loadedmetadata', onLoaded);
    ui.videoPlayer.removeEventListener('error', onError);
  };
  const onLoaded = () => { cleanup(); resolve(); };
  const onError = () => { cleanup(); reject(new Error(t('videoError'))); };
  ui.videoPlayer.addEventListener('loadedmetadata', onLoaded);
  ui.videoPlayer.addEventListener('error', onError);
  ui.videoPlayer.src = videoUrl;
});

const loadSelectedVideo = async ({ preservePlayback = false } = {}) => {
  const previousSource = ui.videoPlayer.src;
  const previousTime = preservePlayback ? ui.videoPlayer.currentTime : 0;
  const wasPlaying = preservePlayback && !ui.videoPlayer.paused && !ui.videoPlayer.ended;
  if (preservePlayback) {
    ui.videoPlayer.pause();
    setLocalizedText(ui.languageStatus, 'switchingAudio');
    ui.languageStatus.classList.remove('hidden');
  }
  ui.extractionStatus.classList.remove('hidden');
  setLocalizedText(ui.extractionStatus, 'preparingVideo');
  setMediaBusy(true);

  const audioId = ui.audioTrack.value;
  const topSubtitleId = ui.topSubtitleTrack.value;
  const bottomSubtitleId = ui.bottomSubtitleTrack.value;

  try {
    // --- STEP 1: Extract subtitles (always fast, text-only) ---
    setLocalizedText(ui.extractionStatus, 'extractingSubtitles');
    const topCues = await extractSubtitleTrack(topSubtitleId, 'top-subtitle');
    const bottomCues = await extractSubtitleTrack(bottomSubtitleId, 'bottom-subtitle');

    // --- STEP 2: Load video ---
    let videoUrl = null;
    const fileExt = videoFile.name.split('.').pop().toLowerCase();

    // Native playback cannot reliably select a non-default audio stream.
    if ((fileExt === 'mp4' || fileExt === 'webm') && audioStreams.length <= 1) {
      setLocalizedText(ui.extractionStatus, 'loadingNativeVideo');
      console.log('File is browser-native format, skipping remux.');
      const directBlob = new Blob([videoFile], { type: fileExt === 'mp4' ? 'video/mp4' : 'video/webm' });
      videoUrl = URL.createObjectURL(directBlob);
    } else {
      // MKV or other container: fast remux to MP4 (copies packets, no re-encoding if possible)
      setLocalizedText(ui.extractionStatus, 'remuxingVideo');
      console.log('MKV detected, performing fast remux...');

      const selectedAudioStream = audioStreams.find(s => s.id === audioId);
      const audioCodec = selectedAudioStream ? selectedAudioStream.details.toLowerCase() : '';
      const isBrowserAudio = ['aac', 'mp3', 'opus', 'flac'].some(c => audioCodec.includes(c));

      let audioArgs = ['-c:a', 'aac', '-ac', '2', '-ar', '44100', '-b:a', '192k'];
      if (isBrowserAudio) {
        audioArgs = ['-c:a', 'copy']; // Skip transcoding — dramatically faster
      }

      const videoCodec = videoStreams[0]?.details.toLowerCase() || '';
      const videoArgs = videoCodec.includes('hevc')
        ? ['-c:v', 'copy', '-tag:v', 'hvc1']
        : ['-c:v', 'copy'];
      const remuxArgs = ['-i', inputVideoPath, '-map', '0:v:0', '-map', `0:${audioId}`, ...videoArgs, ...audioArgs, 'output.mp4'];
      await runFfmpegOutput(remuxArgs, 'Video remux');

      const videoData = await ffmpeg.readFile('output.mp4');
      const videoBlob = new Blob([videoData.buffer], { type: 'video/mp4' });
      videoUrl = URL.createObjectURL(videoBlob);
    }

    // --- STEP 3: Start playback ---
    // Reset progress bar and time displays before loading new source
    ui.progressBar.value = 0;
    ui.progressBar.max = 100;
    ui.currentTimeDisplay.textContent = '00:00';
    ui.durationDisplay.textContent = '00:00';

    parsedTopSubtitle = topCues;
    parsedBottomSubtitle = bottomCues;
    lastTopSubtitleKey = '';
    lastBottomSubtitleKey = '';
    lastAssSubtitleKey = null;
    const sourceReady = loadVideoSource(videoUrl);
    ui.configSection.classList.add('hidden');
    ui.playerSection.classList.remove('hidden');
    await sourceReady;
    if (preservePlayback) {
      ui.videoPlayer.currentTime = Number.isFinite(ui.videoPlayer.duration)
        ? Math.min(previousTime, ui.videoPlayer.duration) : previousTime;
    }
    playbackVideoFile = videoFile;
    loadedAudioTrackId = audioId;
    loadedBottomSubtitleId = bottomSubtitleId;
    ui.videoContainer.classList.add('idle');
    ui.extractionStatus.classList.add('hidden');
    ui.languageStatus.classList.add('hidden');
    updateLearningAudioStatus();
    if (wasPlaying) await ui.videoPlayer.play().catch(console.warn);
    
  } catch (error) {
    setLocalizedText(ui.extractionStatus, 'videoError');
    if (preservePlayback) {
      setLocalizedText(ui.languageStatus, 'videoError');
      ui.languageStatus.classList.remove('hidden');
      if (wasPlaying && ui.videoPlayer.src === previousSource) ui.videoPlayer.play().catch(console.warn);
    }
    console.error(error);
  } finally {
    setMediaBusy(false);
  }
};

ui.loadVideoBtn.addEventListener('click', () => loadSelectedVideo());

ui.learningLanguage.addEventListener('change', async () => {
  learningLanguage = resolveLearningLanguage(ui.learningLanguage.value);
  try {
    localStorage.setItem('paragon.learningLanguage', learningLanguage);
  } catch (error) {
    console.warn('Could not save learning language preference', error);
  }
  const changed = selectAudioForLearningLanguage();
  if (changed && playbackVideoFile === videoFile && videoFile && ui.audioTrack.value !== loadedAudioTrackId) {
    hideTooltip();
    ui.definitionPanel.classList.add('hidden');
    await loadSelectedVideo({ preservePlayback: true });
  }
});

ui.languageToggle.addEventListener('click', async () => {
  interfaceLanguage = interfaceLanguage === 'zh' ? 'en' : 'zh';
  try {
    localStorage.setItem('paragon.interfaceLanguage', interfaceLanguage);
  } catch (error) {
    console.warn('Could not save interface language preference', error);
  }
  applyInterfaceLanguage();
  selectBottomSubtitleForInterfaceLanguage();
  hideTooltip();
  ui.definitionPanel.classList.add('hidden');

  const bottomId = ui.bottomSubtitleTrack.value;
  if (!playbackVideoFile || playbackVideoFile !== videoFile || bottomId === loadedBottomSubtitleId) return;

  setMediaBusy(true);
  setLocalizedText(ui.languageStatus, 'switchingSubtitles');
  ui.languageStatus.classList.remove('hidden');
  try {
    parsedBottomSubtitle = await extractSubtitleTrack(bottomId, 'bottom-subtitle');
    loadedBottomSubtitleId = bottomId;
    ui.languageStatus.classList.add('hidden');
    updateLearningAudioStatus();
  } catch (error) {
    parsedBottomSubtitle = [];
    loadedBottomSubtitleId = 'none';
    setLocalizedText(ui.languageStatus, 'subtitleSwitchError');
    console.error(error);
  } finally {
    lastBottomSubtitleKey = '';
    lastAssSubtitleKey = null;
    syncSubtitles();
    setMediaBusy(false);
  }
});

// --- Word Splitting ---
const escapeHtml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const trackLanguage = (track) => (track === 'bottom' ? ui.targetLang.value : ui.sourceLang.value);

const splitIntoWordSpans = (text, lang) => segmentWords(text, lang).map(({ text: part, isWord }) =>
  isWord ? `<span class="word">${escapeHtml(part)}</span>` : escapeHtml(part).replace(/\n/g, '<br>')
).join('');

// Video Sync Logic
let lastTopSubtitleKey = '';
let lastBottomSubtitleKey = '';
let lastAssSubtitleKey = null;

const renderPlainTrack = (element, cues, interactive, lang, previousKey) => {
  const visible = cues.filter(cue => cue.format !== 'ass');
  const key = `${interactive}:${lang}:${visible.map(cue => `${cue.startSec}:${cue.endSec}:${cue.text}`).join('\u0001')}`;
  if (key !== previousKey) {
    element.innerHTML = visible.map(cue =>
      `<div class="subtitle-line">${interactive
        ? splitIntoWordSpans(cue.text, lang)
        : escapeHtml(cue.text).replace(/\n/g, '<br>')}</div>`
    ).join('');
  }
  element.style.display = visible.length ? 'block' : 'none';
  return key;
};

const positionAssGroup = (group, cue) => {
  const { column, row, left, top } = assAnchorPercent(cue);

  group.style.left = `${left}%`;
  group.style.top = `${top}%`;
  group.style.transform = `translate(${-column * 50}%, ${-(2 - row) * 50}%)`;
  group.style.flexDirection = row === 0 ? 'column-reverse' : 'column';
  group.style.textAlign = ['left', 'center', 'right'][column];
  group.style.maxWidth = `${Math.max(20, 100 - (cue.marginL + cue.marginR) / cue.playResX * 100)}%`;
};

const updateAssLayerBounds = () => {
  const containerWidth = ui.videoContainer.clientWidth;
  const containerHeight = ui.videoContainer.clientHeight;
  const videoWidth = ui.videoPlayer.videoWidth;
  const videoHeight = ui.videoPlayer.videoHeight;
  if (!videoWidth || !videoHeight || !containerWidth || !containerHeight) return;

  const scale = Math.min(containerWidth / videoWidth, containerHeight / videoHeight);
  const displayWidth = videoWidth * scale;
  const displayHeight = videoHeight * scale;
  ui.assSubtitleLayer.style.left = `${(containerWidth - displayWidth) / 2}px`;
  ui.assSubtitleLayer.style.top = `${(containerHeight - displayHeight) / 2}px`;
  ui.assSubtitleLayer.style.width = `${displayWidth}px`;
  ui.assSubtitleLayer.style.height = `${displayHeight}px`;
};

const renderAssCues = (cues) => {
  updateAssLayerBounds();
  const scaleHeight = ui.assSubtitleLayer.clientHeight;
  const key = `${scaleHeight}:${cues.map(({ cue, track, interactive }) =>
    `${interactive}:${track}:${trackLanguage(track)}:${subtitleSize[track]}:${cue.startSec}:${cue.endSec}:${cue.layer}:${cue.alignment}:${cue.position?.x},${cue.position?.y}:${cue.text}`
  ).join('\u0001')}`;
  if (key === lastAssSubtitleKey) return;
  lastAssSubtitleKey = key;

  const groups = new Map();
  ui.assSubtitleLayer.replaceChildren();

  for (const { cue, track, interactive } of cues) {
    const groupKey = [cue.alignment, cue.position?.x, cue.position?.y,
      cue.marginL, cue.marginR, cue.marginV, cue.playResX, cue.playResY].join(':');
    let group = groups.get(groupKey);
    if (!group) {
      group = document.createElement('div');
      group.className = 'ass-cue-group';
      positionAssGroup(group, cue);
      groups.set(groupKey, group);
      ui.assSubtitleLayer.appendChild(group);
    }

    const line = document.createElement('div');
    line.className = `ass-cue${interactive ? ' interactive' : ''}`;
    line.style.fontSize = `${scaledAssFontSize(cue.fontSize, cue.playResY, scaleHeight, subtitleSize[track])}px`;
    if (cue.color) line.style.color = cue.color;
    if (cue.fontFamily) line.style.fontFamily = `"${cue.fontFamily}", sans-serif`;
    line.style.zIndex = String(cue.layer);
    if (interactive) line.innerHTML = splitIntoWordSpans(cue.text, trackLanguage(track));
    else line.textContent = cue.text;
    group.appendChild(line);
  }
};

const layoutSubtitles = () => {
  const videoRect = ui.assSubtitleLayer.getBoundingClientRect();
  if (!videoRect.height) return;

  const edgeGap = 10;
  const controlsTop = ui.controlsPanel.getBoundingClientRect().top;
  const settingsTop = ui.subtitleSettingsPanel.classList.contains('hidden')
    ? Infinity : ui.subtitleSettingsPanel.getBoundingClientRect().top;
  const safeTop = videoRect.top + edgeGap;
  const safeBottom = Math.max(safeTop, Math.min(
    videoRect.bottom - edgeGap,
    ui.videoContainer.classList.contains('idle') ? Infinity : controlsTop - edgeGap,
    settingsTop - edgeGap
  ));

  const assGroups = [...ui.assSubtitleLayer.querySelectorAll('.ass-cue-group')];
  for (const group of assGroups) {
    group.style.translate = 'none';
    const rect = group.getBoundingClientRect();
    let shiftY = Math.min(0, safeBottom - rect.bottom);
    if (rect.top + shiftY < safeTop) shiftY = safeTop - rect.top;
    group.style.translate = `0 ${Math.round(shiftY)}px`;
  }

  const plainBoxes = [ui.topSubtitle, ui.bottomSubtitle]
    .filter(element => element.style.display !== 'none')
    .map(element => element.getBoundingClientRect());
  if (!plainBoxes.length) return;

  const overlayRect = ui.subtitlesOverlay.getBoundingClientRect();
  const overlayHeight = overlayRect.height;
  const maxTop = Math.max(safeTop, safeBottom - overlayHeight);
  const assBoxes = assGroups.map(group => group.getBoundingClientRect());
  const positionedPlainBoxes = plainBoxes.map(box => ({
    left: box.left,
    right: box.right,
    topOffset: box.top - overlayRect.top,
    bottomOffset: box.bottom - overlayRect.top
  }));
  const chosenTop = chooseSubtitleTop(positionedPlainBoxes, assBoxes, safeTop, maxTop, edgeGap);
  ui.subtitlesOverlay.style.top = `${Math.round(chosenTop - ui.videoContainer.getBoundingClientRect().top)}px`;
};

const renderSubtitles = (time) => {
  const translationTrack = ui.translationTrack.value;
  const topCues = activeCues(parsedTopSubtitle, time);
  const bottomCues = activeCues(parsedBottomSubtitle, time);
  lastTopSubtitleKey = renderPlainTrack(ui.topSubtitle, topCues, translationTrack === 'top', trackLanguage('top'), lastTopSubtitleKey);
  lastBottomSubtitleKey = renderPlainTrack(ui.bottomSubtitle, bottomCues, translationTrack === 'bottom', trackLanguage('bottom'), lastBottomSubtitleKey);
  renderAssCues([
    ...topCues.filter(cue => cue.format === 'ass').map(cue => ({ cue, track: 'top', interactive: translationTrack === 'top' })),
    ...bottomCues.filter(cue => cue.format === 'ass').map(cue => ({ cue, track: 'bottom', interactive: translationTrack === 'bottom' }))
  ]);
  layoutSubtitles();
};

let subtitleSyncTimer = null;

const stopSubtitleSync = () => {
  if (subtitleSyncTimer !== null) {
    clearTimeout(subtitleSyncTimer);
    subtitleSyncTimer = null;
  }
};

const syncSubtitles = () => {
  stopSubtitleSync();
  const time = ui.videoPlayer.currentTime;
  renderSubtitles(time);

  if (ui.videoPlayer.paused || ui.videoPlayer.ended) return;
  const nextBoundary = nextSubtitleBoundary([parsedTopSubtitle, parsedBottomSubtitle], time);
  if (nextBoundary === null) return;

  const playbackRate = Math.max(ui.videoPlayer.playbackRate, 0.01);
  const delayMs = Math.max(0, ((nextBoundary - time) / playbackRate) * 1000) + 5;
  subtitleSyncTimer = setTimeout(syncSubtitles, Math.min(delayMs, 60000));
};

ui.videoPlayer.addEventListener('play', syncSubtitles);
ui.videoPlayer.addEventListener('pause', syncSubtitles);
ui.videoPlayer.addEventListener('seeked', syncSubtitles);
ui.videoPlayer.addEventListener('loadeddata', syncSubtitles);
ui.videoPlayer.addEventListener('ratechange', syncSubtitles);
ui.videoPlayer.addEventListener('ended', stopSubtitleSync);
window.addEventListener('resize', () => renderSubtitles(ui.videoPlayer.currentTime));
document.addEventListener('fullscreenchange', () => renderSubtitles(ui.videoPlayer.currentTime));

// Navigation Logic
const jumpToCaption = (direction) => {
  const time = ui.videoPlayer.currentTime;
  const navTrack = ui.navigationTrack.value === 'bottom'
    ? parsedBottomSubtitle
    : parsedTopSubtitle;
  if (navTrack.length === 0) return;

  if (direction === 'next') {
    const nextSub = navTrack.find(s => s.startSec > time);
    if (nextSub) {
      ui.videoPlayer.currentTime = nextSub.startSec;
    }
  } else if (direction === 'prev') {
    // Find the caption that is currently playing or the one just before
    let prevSub = [...navTrack].reverse().find(s => s.endSec < time);
    if (prevSub) {
      ui.videoPlayer.currentTime = prevSub.startSec;
    } else if (navTrack.length > 0) {
      ui.videoPlayer.currentTime = navTrack[0].startSec;
    }
  }
};

ui.nextCaptionBtn.addEventListener('click', () => jumpToCaption('next'));
ui.prevCaptionBtn.addEventListener('click', () => jumpToCaption('prev'));

// Speed Control
ui.playbackSpeed.addEventListener('change', (e) => {
  ui.videoPlayer.playbackRate = parseFloat(e.target.value);
});

// Fullscreen Logic
ui.fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    if (ui.videoContainer.requestFullscreen) {
      ui.videoContainer.requestFullscreen();
    } else if (ui.videoContainer.webkitRequestFullscreen) { /* Safari */
      ui.videoContainer.webkitRequestFullscreen();
    } else if (ui.videoContainer.msRequestFullscreen) { /* IE11 */
      ui.videoContainer.msRequestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) { /* Safari */
      document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) { /* IE11 */
      document.msExitFullscreen();
    }
  }
  // Ensure video player gets focus back so native shortcuts work if needed
  ui.videoPlayer.focus();
});

// Keyboard Shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !ui.subtitleSettingsPanel.classList.contains('hidden')) {
    setSubtitleSettingsOpen(false);
    e.preventDefault();
    return;
  }
  if (ui.subtitleSettingsPanel.contains(e.target) || ui.subtitleSettingsBtn === e.target
    || ui.languageToggle === e.target || ui.learningLanguage === e.target) return;
  // Ignore if user is interacting with an input field
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;

  // Only apply shortcuts if video section is active
  if (ui.playerSection.classList.contains('hidden')) return;

  if (e.key === 'ArrowLeft') {
    jumpToCaption('prev');
    e.preventDefault(); // Prevent default native video seek or scrolling
  } else if (e.key === 'ArrowRight') {
    jumpToCaption('next');
    e.preventDefault();
  } else if (e.key === ' ') { // Spacebar for Play/Pause
    togglePlay();
    e.preventDefault();
  }
});

// --- Custom Controls Logic ---

// Format time in MM:SS
const formatTime = (timeInSeconds) => {
  if (isNaN(timeInSeconds)) return "00:00";
  const m = Math.floor(timeInSeconds / 60).toString().padStart(2, '0');
  const s = Math.floor(timeInSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

// Play/Pause
const togglePlay = () => {
  if (ui.videoPlayer.paused) {
    ui.videoPlayer.play();
  } else {
    ui.videoPlayer.pause();
  }
};
ui.playPauseBtn.addEventListener('click', togglePlay);

ui.videoPlayer.addEventListener('play', () => {
  ui.playPauseBtn.textContent = '⏸';
});
ui.videoPlayer.addEventListener('pause', () => {
  ui.playPauseBtn.textContent = '▶';
});

// Click video to play/pause
ui.videoPlayer.addEventListener('click', togglePlay);

// Progress Bar & Time
ui.videoPlayer.addEventListener('loadedmetadata', () => {
  ui.progressBar.max = ui.videoPlayer.duration;
  ui.durationDisplay.textContent = formatTime(ui.videoPlayer.duration);
});

ui.videoPlayer.addEventListener('timeupdate', () => {
  if (!ui.progressBar.matches(':active')) {
    ui.progressBar.value = ui.videoPlayer.currentTime;
  }
  ui.currentTimeDisplay.textContent = formatTime(ui.videoPlayer.currentTime);
});

ui.progressBar.addEventListener('input', () => {
  ui.videoPlayer.currentTime = ui.progressBar.value;
});

// Volume Control
ui.volumeBar.addEventListener('input', () => {
  ui.videoPlayer.volume = ui.volumeBar.value;
});

// Idle Mouse Hiding Logic
let idleTimeout;
let wordInteractionActive = false;
const resetIdleTimer = () => {
  if (wordInteractionActive || !ui.subtitleSettingsPanel.classList.contains('hidden')) return;
  const wasIdle = ui.videoContainer.classList.contains('idle');
  ui.videoContainer.classList.remove('idle');
  if (wasIdle) layoutSubtitles();
  clearTimeout(idleTimeout);
  idleTimeout = setTimeout(() => {
    ui.videoContainer.classList.add('idle');
    layoutSubtitles();
  }, 3000);
};

ui.videoContainer.addEventListener('mousemove', resetIdleTimer);
ui.videoContainer.addEventListener('click', resetIdleTimer);
ui.videoContainer.addEventListener('mouseleave', () => {
  if (!ui.subtitleSettingsPanel.classList.contains('hidden')) return;
  clearTimeout(idleTimeout);
  wordInteractionActive = false;
  ui.videoContainer.classList.add('idle');
  layoutSubtitles();
});

const positionSubtitleSettingsPanel = () => {
  ui.subtitleSettingsPanel.style.bottom = `${ui.controlsPanel.offsetHeight + 8}px`;
};

const setSubtitleSettingsOpen = (open) => {
  ui.subtitleSettingsPanel.classList.toggle('hidden', !open);
  ui.subtitleSettingsBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    clearTimeout(idleTimeout);
    ui.videoContainer.classList.remove('idle');
    positionSubtitleSettingsPanel();
    layoutSubtitles();
  } else if (ui.videoContainer.matches(':hover')) {
    resetIdleTimer();
    layoutSubtitles();
  } else {
    ui.videoContainer.classList.add('idle');
    layoutSubtitles();
  }
};

ui.subtitleSettingsBtn.addEventListener('click', () => {
  setSubtitleSettingsOpen(ui.subtitleSettingsPanel.classList.contains('hidden'));
});

document.addEventListener('pointerdown', (event) => {
  if (ui.subtitleSettingsPanel.classList.contains('hidden')) return;
  if (ui.subtitleSettingsPanel.contains(event.target) || ui.subtitleSettingsBtn.contains(event.target)) return;
  setSubtitleSettingsOpen(false);
});

window.addEventListener('resize', () => {
  if (!ui.subtitleSettingsPanel.classList.contains('hidden')) {
    positionSubtitleSettingsPanel();
    layoutSubtitles();
  }
});
document.addEventListener('fullscreenchange', () => {
  if (!ui.subtitleSettingsPanel.classList.contains('hidden')) {
    positionSubtitleSettingsPanel();
    layoutSubtitles();
  }
});

// ============================================================
// --- Interactive Word Translation & Definition System ---
// ============================================================

// Words are looked up in the interactive track's language and translated into
// the other track's language.
const currentLookupPair = () => lookupLanguagePair(ui.translationTrack.value, ui.sourceLang.value, ui.targetLang.value);

// --- MyMemory Translation API (hover) ---
const translateWord = async (word, pair) => {
  const clean = cleanWord(word).toLowerCase();
  if (!clean || !pair) return null;

  const cacheKey = `${pair.from}|${pair.to}|${clean}`;
  if (translationCache.has(cacheKey)) return translationCache.get(cacheKey);

  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(clean)}&langpair=${encodeURIComponent(pair.from)}|${encodeURIComponent(pair.to)}`
    );
    const { ok, translation } = parseMyMemoryResponse(await res.json());
    // Only cache real answers so quota or service errors can be retried later.
    if (ok) translationCache.set(cacheKey, translation);
    else console.warn('Translation unavailable for', clean);
    return translation;
  } catch (err) {
    console.warn('Translation API error:', err);
    return null;
  }
};

// --- Wiktionary Definition API (click) ---
const fetchWiktionaryPage = async (title) => {
  const res = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(title)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Wiktionary HTTP ${res.status}`);
  return res.json();
};

const fetchDefinition = async (word, lang) => {
  const clean = cleanWord(word);
  if (!clean || !lang) return null;

  const cacheKey = `wikt|${lang}|${clean}`;
  if (definitionCache.has(cacheKey)) return definitionCache.get(cacheKey);

  try {
    let entries = null;
    for (const title of definitionLookupCandidates(clean)) {
      entries = definitionsForLanguage(await fetchWiktionaryPage(title), lang);
      if (entries) break;
    }
    definitionCache.set(cacheKey, entries);
    return entries;
  } catch (err) {
    console.warn('Wiktionary API error:', err);
    return null;
  }
};

// --- Hover Tooltip Logic ---
let hoverTimeout = null;
let tooltipRequestId = 0;

const positionTooltip = (wordEl) => {
  const wordRect = wordEl.getBoundingClientRect();
  const containerRect = ui.videoContainer.getBoundingClientRect();
  const tooltipWidth = ui.hoverTooltip.offsetWidth;
  const tooltipHeight = ui.hoverTooltip.offsetHeight;
  const { left, top } = chooseTooltipPosition(wordRect, containerRect, tooltipWidth, tooltipHeight);

  ui.hoverTooltip.style.left = `${left}px`;
  ui.hoverTooltip.style.top = `${top}px`;
  ui.hoverTooltip.style.bottom = 'auto';
  ui.hoverTooltip.style.transform = 'none';
};

const showTooltip = (wordEl) => {
  const word = wordEl.textContent;
  const requestId = ++tooltipRequestId;

  // Show loading state
  ui.hoverTooltip.innerHTML = `<span class="tt-word">${escapeHtml(word)}</span><span class="tt-loading">…</span>`;
  ui.hoverTooltip.classList.remove('hidden');
  positionTooltip(wordEl);

  // Fetch translation
  translateWord(word, currentLookupPair()).then(translation => {
    if (requestId !== tooltipRequestId || !wordEl.isConnected) return;
    if (translation) {
      ui.hoverTooltip.innerHTML = `<span class="tt-word">${escapeHtml(word)}</span><span class="tt-translation">${escapeHtml(translation)}</span>`;
    } else {
      ui.hoverTooltip.innerHTML = `<span class="tt-word">${escapeHtml(word)}</span><span class="tt-loading">${escapeHtml(t('noTranslation'))}</span>`;
    }
    positionTooltip(wordEl);
  });
};

const hideTooltip = () => {
  tooltipRequestId++;
  ui.hoverTooltip.classList.add('hidden');
};

// --- Definition Panel Logic ---
let definitionRequestId = 0;

const showDefinitionPanel = async (word) => {
  const clean = cleanWord(word);
  if (!clean) return;
  const requestId = ++definitionRequestId;
  const pair = currentLookupPair();
  const lookupLanguage = trackLanguage(ui.translationTrack.value);
  ui.defPanelContent.innerHTML = `<div class="def-word-header">${escapeHtml(clean)}</div><div class="def-translation">${escapeHtml(t('loading'))}</div>`;
  ui.definitionPanel.classList.remove('hidden');

  const [translation, entries] = await Promise.all([
    translateWord(word, pair),
    fetchDefinition(word, lookupLanguage)
  ]);
  // A newer click has replaced this lookup.
  if (requestId !== definitionRequestId) return;

  let html = `<div class="def-word-header">${escapeHtml(clean)}</div>`;
  html += `<div class="def-translation">${escapeHtml(translation || t('noTranslation'))}</div>`;

  if (entries) {
    for (const entry of entries) {
      if (entry.partOfSpeech) {
        html += `<div class="def-section-title">${escapeHtml(entry.partOfSpeech)}</div>`;
      }
      for (const def of (entry.definitions || []).slice(0, 4)) {
        // Wiktionary definitions contain HTML, sanitize by extracting text
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = def.definition || '';
        const defText = tempDiv.textContent.trim();
        if (defText) {
          html += `<div class="def-entry">${escapeHtml(defText)}</div>`;
        }
      }
    }
  } else {
    html += `<div class="def-entry" style="color:#999;">${escapeHtml(t('noDefinitions', { word: clean }))}</div>`;
  }

  ui.defPanelContent.innerHTML = html;
};

ui.defPanelClose.addEventListener('click', () => {
  ui.definitionPanel.classList.add('hidden');
});

// --- Event Delegation on Subtitle Elements ---
// Wait briefly before pausing and translating so sweeping the pointer across a
// subtitle line does not fire a request for every word it passes.
const HOVER_DELAY_MS = 150;
let hoverShowTimeout = null;

const handleWordHover = (e) => {
  const wordEl = e.target.closest('.word');
  if (!wordEl) return;

  // Keep the layout steady while the pointer is selecting a subtitle word.
  wordInteractionActive = true;
  clearTimeout(idleTimeout);
  clearTimeout(hoverTimeout);
  clearTimeout(hoverShowTimeout);

  hoverShowTimeout = setTimeout(() => {
    if (!wordEl.isConnected || !wordEl.matches(':hover')) return;
    // Auto-pause
    if (!ui.videoPlayer.paused) {
      wasPlayingBeforeHover = true;
      ui.videoPlayer.pause();
    }
    showTooltip(wordEl);
  }, HOVER_DELAY_MS);
};

const handleWordLeave = (e) => {
  // Only hide if we're leaving the subtitle area entirely
  const related = e.relatedTarget;
  if (related && (related.closest('.subtitle') || related.closest('.ass-cue') || related.closest('.hover-tooltip'))) return;

  clearTimeout(hoverShowTimeout);
  hoverTimeout = setTimeout(() => {
    hideTooltip();
    wordInteractionActive = false;
    if (ui.videoContainer.matches(':hover')) resetIdleTimer();
    // Resume if we auto-paused
    if (wasPlayingBeforeHover) {
      wasPlayingBeforeHover = false;
      ui.videoPlayer.play();
    }
  }, 300);
};

const handleWordClick = (e) => {
  const wordEl = e.target.closest('.word');
  if (!wordEl) return;
  e.stopPropagation(); // Don't trigger video play/pause
  showDefinitionPanel(wordEl.textContent);
};

// Attach to both subtitle containers
[ui.topSubtitle, ui.bottomSubtitle, ui.assSubtitleLayer].forEach(subEl => {
  subEl.addEventListener('mouseover', handleWordHover);
  subEl.addEventListener('mouseout', handleWordLeave);
  subEl.addEventListener('click', handleWordClick);
});

applyInterfaceLanguage();
selectBottomSubtitleForInterfaceLanguage();
