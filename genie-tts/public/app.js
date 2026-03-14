const serverUrlInput = document.getElementById('serverUrl');
const serverProviderInput = document.getElementById('serverProvider');
const enableConv1dPadToNc1dInput = document.getElementById('enableConv1dPadToNc1d');
const characterNameInput = document.getElementById('characterName');
const characterPresetInput = document.getElementById('characterPreset');
const modelDirInput = document.getElementById('modelDir');
const useV2ProPlusInput = document.getElementById('useV2ProPlus');
const proPlusModelDirInput = document.getElementById('proPlusModelDir');
const languageInput = document.getElementById('language');
const referenceFileInput = document.getElementById('referenceFile');
const whisperModelInput = document.getElementById('whisperModel');
const whisperLanguageInput = document.getElementById('whisperLanguage');
const referenceTextInput = document.getElementById('referenceText');
const targetTextInput = document.getElementById('targetText');
const splitSentenceInput = document.getElementById('splitSentence');
const chunkMaxLenInput = document.getElementById('chunkMaxLen');
const chunkMinLenInput = document.getElementById('chunkMinLen');

const healthBtn = document.getElementById('healthBtn');
const startManagedServerBtn = document.getElementById('startManagedServerBtn');
const stopManagedServerBtn = document.getElementById('stopManagedServerBtn');
const findModelsBtn = document.getElementById('findModelsBtn');
const useSelectedCharacterBtn = document.getElementById('useSelectedCharacterBtn');
const loadCharacterBtn = document.getElementById('loadCharacterBtn');
const unloadCharacterBtn = document.getElementById('unloadCharacterBtn');
const transcribeReferenceBtn = document.getElementById('transcribeReferenceBtn');
const setReferenceBtn = document.getElementById('setReferenceBtn');
const clearReferenceCacheBtn = document.getElementById('clearReferenceCacheBtn');
const generateBtn = document.getElementById('generateBtn');
const stopBtn = document.getElementById('stopBtn');
const splitPreviewBtn = document.getElementById('splitPreviewBtn');
const runChunkTestBtn = document.getElementById('runChunkTestBtn');
const stopChunkTestBtn = document.getElementById('stopChunkTestBtn');

const healthStatus = document.getElementById('healthStatus');
const managedServerStatus = document.getElementById('managedServerStatus');
const modelSearchResult = document.getElementById('modelSearchResult');
const statusMessage = document.getElementById('statusMessage');
const elapsedValue = document.getElementById('elapsedValue');
const serverEcho = document.getElementById('serverEcho');
const player = document.getElementById('player');
const downloadLink = document.getElementById('downloadLink');
const traceLog = document.getElementById('traceLog');
const chunkPlanLog = document.getElementById('chunkPlanLog');
const chunkMetricsLog = document.getElementById('chunkMetricsLog');

let currentObjectUrl = null;
let discoveredCharacters = [];
let chunkRunToken = 0;
let chunkPlaylist = [];
let chunkPlaybackActive = false;
let chunkRunState = null;

function logTrace(title, payload) {
  const stamp = new Date().toLocaleTimeString();
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  const next = `[${stamp}] ${title}\n${body}`;
  traceLog.textContent = traceLog.textContent === 'No requests yet.'
    ? next
    : `${next}\n\n${traceLog.textContent}`;
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle('error', isError);
}

function renderManagedServerStatus(status) {
  if (!status || !status.running) {
    managedServerStatus.textContent = 'No managed server started.';
    return;
  }

  const provider = status.config?.provider || 'unknown';
  const nc1d = status.config?.enableConv1dPadToNc1d ? 'nc1d on' : 'nc1d off';
  managedServerStatus.textContent = `Managed server running (${provider}, ${nc1d}, pid ${status.pid})`;
}

function fillCharacterForm(item) {
  if (!item) return;
  characterPresetInput.value = item.modelDir;
  characterNameInput.value = item.characterName || characterNameInput.value;
  modelDirInput.value = item.modelDir || modelDirInput.value;
  useV2ProPlusInput.checked = Boolean(item.supportsV2ProPlus);
}

function renderCharacterOptions(items) {
  discoveredCharacters = items;
  characterPresetInput.innerHTML = '';

  if (items.length === 0) {
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = 'No characters found';
    characterPresetInput.append(emptyOption);
    return;
  }

  for (const item of items) {
    const option = document.createElement('option');
    option.value = item.modelDir;
    option.textContent = item.label;
    characterPresetInput.append(option);
  }

  const current = items.find((item) => item.modelDir === modelDirInput.value.trim()) || items[0];
  fillCharacterForm(current);
}

async function scanCharacters() {
  modelSearchResult.textContent = 'Scanning characters…';
  const response = await fetch('/api/find-characters');
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || 'Character scan failed.');
  }

  renderCharacterOptions(data.items || []);

  if ((data.items || []).length === 0) {
    modelSearchResult.textContent = 'No Genie characters found.';
    return data;
  }

  modelSearchResult.textContent = `Found ${(data.items || []).length} character bundle(s).`;
  return data;
}

function clearAudio() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  player.removeAttribute('src');
  player.load();
  downloadLink.classList.add('hidden');
  downloadLink.removeAttribute('href');
  elapsedValue.textContent = '—';
}

function resetChunkState() {
  chunkRunToken += 1;
  for (const item of chunkPlaylist) {
    if (item?.url) {
      URL.revokeObjectURL(item.url);
    }
  }
  chunkPlaylist = [];
  chunkPlaybackActive = false;
  chunkRunState = null;
  player.pause();
  clearAudio();
}

function renderChunkPlan(items) {
  if (!items || items.length === 0) {
    chunkPlanLog.textContent = 'No chunk plan yet.';
    return;
  }

  chunkPlanLog.textContent = items
    .map((item) => `#${item.index} [len ${item.effectiveLength}] ${item.text}`)
    .join('\n\n');
}

function updateChunkMetrics() {
  if (!chunkRunState) {
    chunkMetricsLog.textContent = 'No chunk run yet.';
    return;
  }

  const avgSynthMs = chunkRunState.generatedChunks
    ? Math.round(chunkRunState.totalSynthMs / chunkRunState.generatedChunks)
    : 0;
  const avgDurationSec = chunkRunState.generatedChunks
    ? (chunkRunState.totalDurationSec / chunkRunState.generatedChunks).toFixed(2)
    : '0.00';
  const rtf = chunkRunState.totalDurationSec > 0
    ? (chunkRunState.totalSynthMs / 1000 / chunkRunState.totalDurationSec).toFixed(2)
    : '0.00';

  chunkMetricsLog.textContent = [
    `Chunks planned: ${chunkRunState.totalChunks}`,
    `Chunks generated: ${chunkRunState.generatedChunks}`,
    `Chunks played: ${chunkRunState.playedChunks}`,
    `Queued for playback: ${chunkPlaylist.length}`,
    `Average synth: ${avgSynthMs} ms`,
    `Average audio: ${avgDurationSec} s`,
    `Approx RTF: ${rtf}`,
    `Max gap: ${Math.round(chunkRunState.maxGapMs)} ms`,
    `Last gap: ${Math.round(chunkRunState.lastGapMs)} ms`
  ].join('\n');
}

async function readWavDuration(blob) {
  const buffer = await blob.arrayBuffer();
  if (buffer.byteLength < 44) {
    return 0;
  }

  const view = new DataView(buffer);
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const size = view.getUint32(offset + 4, true);

    if (id === 'fmt ') {
      byteRate = view.getUint32(offset + 16, true);
    } else if (id === 'data') {
      dataSize = size;
      break;
    }

    offset += 8 + size + (size % 2);
  }

  if (!byteRate || !dataSize) {
    return 0;
  }

  return dataSize / byteRate;
}

async function fetchChunkPlan() {
  const payload = {
    text: targetTextInput.value.trim(),
    maxLen: Number(chunkMaxLenInput.value || 40),
    minLen: Number(chunkMinLenInput.value || 5)
  };
  const data = await postJson('/api/split-text', payload);
  renderChunkPlan(data.items || []);
  return data;
}

async function maybePlayNextChunk(expectedRunToken) {
  if (chunkPlaybackActive || chunkPlaylist.length === 0) {
    return;
  }

  const next = chunkPlaylist.shift();
  if (!next || next.runToken !== expectedRunToken || expectedRunToken !== chunkRunToken) {
    return;
  }

  chunkPlaybackActive = true;
  const gapMs = chunkRunState?.lastPlaybackEndedAt
    ? Math.max(0, performance.now() - chunkRunState.lastPlaybackEndedAt)
    : 0;

  if (chunkRunState) {
    chunkRunState.lastGapMs = gapMs;
    chunkRunState.maxGapMs = Math.max(chunkRunState.maxGapMs, gapMs);
  }

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }

  currentObjectUrl = next.url;
  player.src = next.url;
  downloadLink.href = next.url;
  downloadLink.classList.remove('hidden');
  elapsedValue.textContent = `${next.synthMs} ms`;

  const finalize = () => {
    if (chunkRunState) {
      chunkRunState.playedChunks += 1;
      chunkRunState.lastPlaybackEndedAt = performance.now();
      updateChunkMetrics();
      if (
        chunkRunState.generatedChunks === chunkRunState.totalChunks &&
        chunkRunState.playedChunks === chunkRunState.totalChunks &&
        chunkPlaylist.length === 0
      ) {
        setStatus('Chunk test complete.');
      }
    }
    chunkPlaybackActive = false;
    maybePlayNextChunk(expectedRunToken).catch(() => {});
  };

  player.onended = finalize;
  player.onerror = finalize;

  try {
    await player.play();
  } catch {
    finalize();
    return;
  }

  updateChunkMetrics();
}

function getCommonPayload() {
  return {
    serverUrl: serverUrlInput.value.trim(),
    characterName: characterNameInput.value.trim(),
    language: languageInput.value,
    useV2ProPlus: useV2ProPlusInput.checked,
    proPlusModelDir: proPlusModelDirInput.value.trim()
  };
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || data.detail || `HTTP ${response.status}`);
  }
  return data;
}

async function refreshManagedServerStatus() {
  try {
    const response = await fetch('/api/server/status');
    const data = await response.json();
    renderManagedServerStatus(data);
  } catch {
    managedServerStatus.textContent = 'Managed server status unavailable.';
  }
}

healthBtn.addEventListener('click', async () => {
  try {
    healthStatus.textContent = 'Checking…';
    const serverUrl = serverUrlInput.value.trim();
    const response = await fetch(`/api/health?serverUrl=${encodeURIComponent(serverUrl)}`);
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Health check failed.');
    }
    healthStatus.textContent = `Ready: ${data.title}`;
    serverEcho.textContent = data.serverUrl;
    if (!modelDirInput.value.trim() && data.defaultModelDir) {
      modelDirInput.value = data.defaultModelDir;
    }
    if (!proPlusModelDirInput.value.trim() && data.defaultProPlusDir) {
      proPlusModelDirInput.value = data.defaultProPlusDir;
    }
    if (!modelDirInput.value.trim() && data.defaultModelDir) {
      modelDirInput.value = data.defaultModelDir;
    }
    setStatus('Genie server is reachable.');
    logTrace('Health', data);
    await scanCharacters().catch(() => {});
  } catch (error) {
    healthStatus.textContent = 'Offline';
    setStatus(error.message || 'Health check failed.', true);
    logTrace('Health Error', { error: error.message });
  }
});

startManagedServerBtn.addEventListener('click', async () => {
  try {
    managedServerStatus.textContent = 'Starting managed server…';
    const data = await postJson('/api/server/start', {
      serverUrl: serverUrlInput.value.trim(),
      provider: serverProviderInput.value,
      enableConv1dPadToNc1d: enableConv1dPadToNc1dInput.checked,
    });
    renderManagedServerStatus(data);
    setStatus('Managed Genie server started.');
    logTrace('Managed Server Start', data);
    healthBtn.click();
  } catch (error) {
    managedServerStatus.textContent = 'Managed server start failed.';
    setStatus(error.message || 'Managed Genie server start failed.', true);
    logTrace('Managed Server Start Error', { error: error.message });
  }
});

stopManagedServerBtn.addEventListener('click', async () => {
  try {
    const data = await postJson('/api/server/stop', {});
    renderManagedServerStatus(data);
    setStatus('Managed Genie server stopped.');
    logTrace('Managed Server Stop', data);
  } catch (error) {
    setStatus(error.message || 'Managed Genie server stop failed.', true);
    logTrace('Managed Server Stop Error', { error: error.message });
  }
});

findModelsBtn.addEventListener('click', async () => {
  try {
    const data = await scanCharacters();
    if ((data.items || []).length === 0) {
      setStatus('No Genie characters found.', true);
      logTrace('Find Characters', data);
      return;
    }
    setStatus('Character list refreshed.');
    logTrace('Find Characters', data);
  } catch (error) {
    modelSearchResult.textContent = 'Search failed.';
    setStatus(error.message || 'Character scan failed.', true);
    logTrace('Find Characters Error', { error: error.message });
  }
});

characterPresetInput.addEventListener('change', () => {
  const selected = discoveredCharacters.find((item) => item.modelDir === characterPresetInput.value);
  fillCharacterForm(selected);
});

useSelectedCharacterBtn.addEventListener('click', () => {
  const selected = discoveredCharacters.find((item) => item.modelDir === characterPresetInput.value);
  if (!selected) {
    setStatus('No discovered character selected.', true);
    return;
  }

  fillCharacterForm(selected);
  setStatus(`Using ${selected.label}.`);
  logTrace('Use Selected Character', selected);
});

loadCharacterBtn.addEventListener('click', async () => {
  try {
    const payload = {
      ...getCommonPayload(),
      modelDir: modelDirInput.value.trim()
    };
    const data = await postJson('/api/load-character', payload);
    setStatus(data.message || 'Character loaded.');
    logTrace('Load Character', data);
  } catch (error) {
    setStatus(error.message || 'Failed to load character.', true);
    logTrace('Load Character Error', { error: error.message });
  }
});

unloadCharacterBtn.addEventListener('click', async () => {
  try {
    const data = await postJson('/api/unload-character', getCommonPayload());
    setStatus(data.message || 'Character unloaded.');
    logTrace('Unload Character', data);
  } catch (error) {
    setStatus(error.message || 'Failed to unload character.', true);
    logTrace('Unload Character Error', { error: error.message });
  }
});

transcribeReferenceBtn.addEventListener('click', async () => {
  const file = referenceFileInput.files?.[0];
  if (!file) {
    setStatus('Select a reference audio file first.', true);
    return;
  }

  try {
    transcribeReferenceBtn.disabled = true;
    setStatus('Transcribing reference audio with faster-whisper…');

    const payload = new FormData();
    payload.set('reference', file);
    payload.set('whisperModel', whisperModelInput.value);
    payload.set('whisperLanguage', whisperLanguageInput.value.trim());

    const response = await fetch('/api/transcribe-reference', {
      method: 'POST',
      body: payload
    });
    const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    referenceTextInput.value = data.text || '';
    setStatus('Reference audio transcribed.');
    logTrace('Transcribe Reference', {
      language: data.language,
      probability: data.language_probability,
      text: data.text
    });
  } catch (error) {
    setStatus(error.message || 'Reference transcription failed.', true);
    logTrace('Transcribe Reference Error', { error: error.message });
  } finally {
    transcribeReferenceBtn.disabled = false;
  }
});

setReferenceBtn.addEventListener('click', async () => {
  clearAudio();

  const file = referenceFileInput.files?.[0];
  if (!file) {
    setStatus('Select a reference audio file first.', true);
    return;
  }

  if (!referenceTextInput.value.trim()) {
    setStatus('Reference text is required.', true);
    return;
  }

  try {
    const payload = new FormData();
    payload.set('serverUrl', serverUrlInput.value.trim());
    payload.set('characterName', characterNameInput.value.trim());
    payload.set('language', languageInput.value);
    payload.set('audioText', referenceTextInput.value.trim());
    payload.set('reference', file);

    const response = await fetch('/api/set-reference-audio', {
      method: 'POST',
      body: payload
    });
    const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    setStatus(data.message || 'Reference audio set.');
    logTrace('Set Reference', data);
  } catch (error) {
    setStatus(error.message || 'Failed to set reference audio.', true);
    logTrace('Set Reference Error', { error: error.message });
  }
});

clearReferenceCacheBtn.addEventListener('click', async () => {
  try {
    const data = await postJson('/api/clear-reference-cache', {
      serverUrl: serverUrlInput.value.trim()
    });
    setStatus(data.message || 'Reference cache cleared.');
    logTrace('Clear Reference Cache', data);
  } catch (error) {
    setStatus(error.message || 'Failed to clear reference cache.', true);
    logTrace('Clear Reference Cache Error', { error: error.message });
  }
});

generateBtn.addEventListener('click', async () => {
  clearAudio();

  const payload = {
    ...getCommonPayload(),
    text: targetTextInput.value.trim(),
    splitSentence: splitSentenceInput.checked
  };

  if (!payload.text) {
    setStatus('Target text is required.', true);
    return;
  }

  generateBtn.disabled = true;
  setStatus('Generating audio…');

  try {
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    const blob = await response.blob();
    currentObjectUrl = URL.createObjectURL(blob);
    player.src = currentObjectUrl;
    downloadLink.href = currentObjectUrl;
    downloadLink.classList.remove('hidden');
    elapsedValue.textContent = `${response.headers.get('X-Genie-Elapsed-Ms') || '—'} ms`;
    player.play().catch(() => {});
    setStatus('Generation complete.');
    logTrace('Generate', {
      characterName: payload.characterName,
      textLength: payload.text.length,
      elapsedMs: response.headers.get('X-Genie-Elapsed-Ms') || null
    });
  } catch (error) {
    setStatus(error.message || 'Generation failed.', true);
    logTrace('Generate Error', { error: error.message });
  } finally {
    generateBtn.disabled = false;
  }
});

stopBtn.addEventListener('click', async () => {
  try {
    const data = await postJson('/api/stop', {
      serverUrl: serverUrlInput.value.trim()
    });
    setStatus(data.message || 'Stop sent.');
    logTrace('Stop', data);
  } catch (error) {
    setStatus(error.message || 'Failed to stop.', true);
    logTrace('Stop Error', { error: error.message });
  }
});

splitPreviewBtn.addEventListener('click', async () => {
  try {
    const data = await fetchChunkPlan();
    setStatus(`Split into ${data.count} chunk(s).`);
    logTrace('Split Preview', data);
  } catch (error) {
    setStatus(error.message || 'Chunk preview failed.', true);
    logTrace('Split Preview Error', { error: error.message });
  }
});

stopChunkTestBtn.addEventListener('click', () => {
  resetChunkState();
  chunkPlanLog.textContent = chunkPlanLog.textContent || 'No chunk plan yet.';
  updateChunkMetrics();
  setStatus('Chunk test stopped.');
  logTrace('Chunk Test Stopped', { ok: true });
});

refreshManagedServerStatus().catch(() => {});

runChunkTestBtn.addEventListener('click', async () => {
  if (!targetTextInput.value.trim()) {
    setStatus('Target text is required.', true);
    return;
  }

  resetChunkState();
  const runToken = chunkRunToken;
  splitPreviewBtn.disabled = true;
  runChunkTestBtn.disabled = true;
  stopChunkTestBtn.disabled = false;

  try {
    const plan = await fetchChunkPlan();
    if (!plan.items || plan.items.length === 0) {
      throw new Error('No chunks produced from the target text.');
    }

    chunkRunState = {
      totalChunks: plan.items.length,
      generatedChunks: 0,
      playedChunks: 0,
      totalSynthMs: 0,
      totalDurationSec: 0,
      maxGapMs: 0,
      lastGapMs: 0,
      lastPlaybackEndedAt: 0
    };
    updateChunkMetrics();
    setStatus(`Chunk test running with ${plan.count} chunk(s)…`);
    logTrace('Chunk Test Started', {
      count: plan.count,
      maxLen: plan.maxLen,
      minLen: plan.minLen
    });

    for (const item of plan.items) {
      if (runToken !== chunkRunToken) {
        return;
      }

      const payload = {
        ...getCommonPayload(),
        text: item.text,
        splitSentence: false
      };
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const synthMs = Number(response.headers.get('X-Genie-Elapsed-Ms') || 0);
      const durationSec = await readWavDuration(blob);
      const url = URL.createObjectURL(blob);

      chunkPlaylist.push({
        index: item.index,
        text: item.text,
        url,
        synthMs,
        durationSec,
        runToken
      });

      chunkRunState.generatedChunks += 1;
      chunkRunState.totalSynthMs += synthMs;
      chunkRunState.totalDurationSec += durationSec;
      updateChunkMetrics();
      logTrace('Chunk Generated', {
        index: item.index,
        text: item.text,
        synthMs,
        durationSec: Number(durationSec.toFixed(2))
      });

      await maybePlayNextChunk(runToken);
    }

    setStatus('Chunk generation complete. Waiting for playlist to finish.');
    logTrace('Chunk Test Queued', {
      generatedChunks: chunkRunState.generatedChunks
    });
  } catch (error) {
    setStatus(error.message || 'Chunk test failed.', true);
    logTrace('Chunk Test Error', { error: error.message });
  } finally {
    splitPreviewBtn.disabled = false;
    runChunkTestBtn.disabled = false;
  }
});
