const express = require('express');
const multer = require('multer');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn } = require('node:child_process');

const app = express();
const ROOT = __dirname;
const TMP_DIR = path.join(ROOT, 'tmp');
const DATA_DIR = path.join(ROOT, 'data');
const VOICE_PRESETS_FILE = path.join(DATA_DIR, 'genie-voice-presets.json');
const VOICE_UPLOADS_DIR = path.join(DATA_DIR, 'voices');
const PORT = process.env.PORT ? Number(process.env.PORT) : 3088;
const DEFAULT_UPSTREAM_SERVER_URL = process.env.GENIE_SERVER_URL || 'http://127.0.0.1:8000';
const GENIE_SAMPLE_RATE = 32000;
const GENIE_CHANNELS = 1;
const GENIE_BITS_PER_SAMPLE = 16;
const WINDOWS_DEFAULT_GENIE_PROPLUS_DIR = 'C:\\Python27\\Lib\\site-packages\\genie_tts\\Data\\v2ProPlus\\Models';

function splitEnvPaths(name) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return [];
  return raw
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
}

const DEFAULT_CHARACTER_ROOT_CANDIDATES = [
  ...splitEnvPaths('GENIE_CHARACTER_ROOTS'),
  path.join(ROOT, 'models', 'High-Logic-Genie', 'CharacterModels', 'v2ProPlus')
];
const DEFAULT_MIKA_CHARACTER_CANDIDATES = DEFAULT_CHARACTER_ROOT_CANDIDATES.map((root) => path.join(root, 'mika'));
const DEFAULT_GENIE_MODEL_CANDIDATES = [
  ...DEFAULT_MIKA_CHARACTER_CANDIDATES.map((root) => path.join(root, 'tts_models'))
];
const DEFAULT_GENIE_PROPLUS_DIR = splitEnvPaths('GENIE_PROPLUS_MODELS_DIR')[0]
  || path.join(ROOT, 'models', 'High-Logic-Genie', 'Data', 'v2ProPlus', 'Models')
  || WINDOWS_DEFAULT_GENIE_PROPLUS_DIR;
const DEFAULT_CONVERTED_V2PRO_CANDIDATES = [
  path.join(ROOT, 'models', 'converted', 'gpt-sovits-v2proplus-default')
];
const REQUIRED_GENIE_V2_FILES = [
  't2s_encoder_fp32.onnx',
  't2s_encoder_fp32.bin',
  't2s_first_stage_decoder_fp32.onnx',
  't2s_stage_decoder_fp32.onnx',
  't2s_shared_fp16.bin',
  'vits_fp32.onnx',
  'vits_fp16.bin'
];
const REQUIRED_GENIE_V2PROPLUS_FILES = [
  ...REQUIRED_GENIE_V2_FILES,
  'prompt_encoder_fp32.onnx',
  'prompt_encoder_fp16.bin'
];
const REQUIRED_PROPLUS_OVERLAY_FILES = [
  'prompt_encoder_fp32.onnx',
  'prompt_encoder_fp16.bin'
];
const DEFAULT_REFERENCE_LANGUAGE = 'English';
let voicePresetState = null;
let managedGenieServerProcess = null;
let managedGenieServerConfig = null;
let managedGenieServerLogTail = [];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 32 * 1024 * 1024
  }
});

app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));

function ensureTmpDir() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function normalizeServerUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    throw createError(400, 'Genie server URL is required.');
  }

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

function createError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function isRiffWav(buffer) {
  return buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WAVE';
}

function wrapPcm16LeAsWav(pcmBuffer, sampleRate = GENIE_SAMPLE_RATE, channels = GENIE_CHANNELS, bitsPerSample = GENIE_BITS_PER_SAMPLE) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}

function isValidGenieV2Dir(dirPath) {
  return REQUIRED_GENIE_V2_FILES.every((file) => exists(path.join(dirPath, file)));
}

function isValidGenieV2ProPlusDir(dirPath) {
  return REQUIRED_GENIE_V2PROPLUS_FILES.every((file) => exists(path.join(dirPath, file)));
}

function isValidGenieProPlusOverlayDir(dirPath) {
  return REQUIRED_PROPLUS_OVERLAY_FILES.every((file) => exists(path.join(dirPath, file)));
}

function getDefaultModelDir() {
  for (const candidate of DEFAULT_GENIE_MODEL_CANDIDATES) {
    if (isValidGenieV2ProPlusDir(candidate) || isValidGenieV2Dir(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function copyDirContents(sourceDir, targetDir) {
  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await ensureDir(targetPath);
      await copyDirContents(sourcePath, targetPath);
      continue;
    }

    if (entry.isFile()) {
      await fsp.copyFile(sourcePath, targetPath);
    }
  }
}

async function prepareRuntimeModelDir(baseModelDir, proPlusModelDir, useV2ProPlus) {
  const normalizedBase = path.resolve(baseModelDir);
  const baseIsV2 = isValidGenieV2Dir(normalizedBase);
  const baseIsV2ProPlus = isValidGenieV2ProPlusDir(normalizedBase);

  if (!baseIsV2 && !baseIsV2ProPlus) {
    throw createError(
      400,
      `Model folder is invalid or incomplete: ${normalizedBase}. A working Genie folder needs the ONNX files and bin sidecars, for example a full CharacterModels/v2ProPlus/*/tts_models bundle.`
    );
  }

  if (!useV2ProPlus || baseIsV2ProPlus) {
    return {
      runtimeModelDir: normalizedBase,
      mode: baseIsV2ProPlus ? 'v2ProPlus' : 'v2'
    };
  }

  const normalizedProPlus = path.resolve(proPlusModelDir);
  if (!isValidGenieProPlusOverlayDir(normalizedProPlus)) {
    throw createError(
      400,
      `v2ProPlus add-on folder is invalid or incomplete: ${normalizedProPlus}. It needs prompt_encoder_fp32.onnx and prompt_encoder_fp16.bin.`
    );
  }

  const mergeKey = crypto
    .createHash('sha1')
    .update(`${normalizedBase}::${normalizedProPlus}`)
    .digest('hex')
    .slice(0, 12);
  const runtimeModelDir = path.join(TMP_DIR, 'genie-runtime-models', mergeKey);

  if (!exists(runtimeModelDir)) {
    await ensureDir(runtimeModelDir);
    await copyDirContents(normalizedBase, runtimeModelDir);
    await copyDirContents(normalizedProPlus, runtimeModelDir);
  }

  return {
    runtimeModelDir,
    mode: 'v2ProPlus'
  };
}

async function findGenieModelDirs(maxResults = 20) {
  const directCandidates = [
    ...DEFAULT_GENIE_MODEL_CANDIDATES
  ].filter((dir) => exists(dir) && (isValidGenieV2Dir(dir) || isValidGenieV2ProPlusDir(dir)));

  const roots = [
    path.resolve(ROOT),
    path.join(ROOT, 'models'),
    path.join('C:\\Python27', 'Lib', 'site-packages'),
    path.join(os.homedir(), 'Documents', 'GitHub'),
    path.join(os.homedir(), 'Downloads'),
    path.join(os.homedir(), 'Documents')
  ].filter((value, index, array) => array.indexOf(value) === index && exists(value));

  const results = [...directCandidates];
  const visited = new Set();
  const ignored = new Set([
    'node_modules',
    '.git',
    '.venv',
    'venv',
    '__pycache__',
    'GenieData',
    '.cache',
    'dist',
    'build'
  ]);

  async function walk(dirPath, depth) {
    if (results.length >= maxResults) return;
    const normalized = path.resolve(dirPath);
    if (visited.has(normalized)) return;
    visited.add(normalized);

    if (isValidGenieV2ProPlusDir(normalized) || isValidGenieV2Dir(normalized)) {
      results.push(normalized);
      if (results.length >= maxResults) return;
    }

    if (depth <= 0) return;

    let entries = [];
    try {
      entries = await fsp.readdir(normalized, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (ignored.has(entry.name)) continue;
      await walk(path.join(normalized, entry.name), depth - 1);
      if (results.length >= maxResults) return;
    }
  }

  for (const root of roots) {
    await walk(root, 8);
    if (results.length >= maxResults) break;
  }

  return results
    .filter((value, index, array) => array.indexOf(value) === index)
    .sort((left, right) => Number(isValidGenieV2ProPlusDir(right)) - Number(isValidGenieV2ProPlusDir(left)));
}

function getCharacterRoots() {
  return [
    ...DEFAULT_CHARACTER_ROOT_CANDIDATES.map((root) => path.dirname(root))
  ].filter((root) => exists(root));
}

async function findGenieCharacters(maxResults = 100) {
  const items = [];
  const seenModelDirs = new Set();
  const seenKeys = new Set();

  for (const candidateDir of DEFAULT_CONVERTED_V2PRO_CANDIDATES) {
    const normalizedModelDir = path.resolve(candidateDir);
    if (!seenModelDirs.has(normalizedModelDir) && (isValidGenieV2ProPlusDir(normalizedModelDir) || isValidGenieV2Dir(normalizedModelDir))) {
      seenModelDirs.add(normalizedModelDir);
      seenKeys.add('v2proplus:default');
      items.push({
        key: 'v2proplus:default',
        label: 'Default (v2ProPlus)',
        characterName: 'gpt_sovits_v2pro_default',
        variant: 'v2ProPlus',
        modelDir: normalizedModelDir,
        sourceRoot: path.dirname(normalizedModelDir),
        supportsV2ProPlus: isValidGenieV2ProPlusDir(normalizedModelDir)
      });
    }
  }

  const roots = getCharacterRoots();
  for (const root of roots) {
    let variants = [];
    try {
      variants = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const variantEntry of variants) {
      if (!variantEntry.isDirectory()) continue;
      const variantDir = path.join(root, variantEntry.name);

      let characterDirs = [];
      try {
        characterDirs = await fsp.readdir(variantDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const characterEntry of characterDirs) {
        if (!characterEntry.isDirectory()) continue;
        const characterDir = path.join(variantDir, characterEntry.name);
        const modelDir = path.join(characterDir, 'tts_models');

        if (!isValidGenieV2Dir(modelDir) && !isValidGenieV2ProPlusDir(modelDir)) {
          continue;
        }

        const normalizedModelDir = path.resolve(modelDir);
        if (seenModelDirs.has(normalizedModelDir)) {
          continue;
        }
        seenModelDirs.add(normalizedModelDir);
        const key = `${variantEntry.name}:${characterEntry.name}`.toLowerCase();
        if (seenKeys.has(key)) {
          continue;
        }
        seenKeys.add(key);

        items.push({
          key,
          label: `${characterEntry.name} (${variantEntry.name})`,
          characterName: characterEntry.name,
          variant: variantEntry.name,
          modelDir: normalizedModelDir,
          sourceRoot: root,
          supportsV2ProPlus: isValidGenieV2ProPlusDir(modelDir)
        });

        if (items.length >= maxResults) {
          return items.sort((left, right) => left.label.localeCompare(right.label));
        }
      }
    }
  }

  return items.sort((left, right) => left.label.localeCompare(right.label));
}

async function writeTempFile(buffer, fileName) {
  ensureTmpDir();
  const extension = path.extname(fileName || '').toLowerCase() || '.wav';
  const output = path.join(TMP_DIR, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  await fsp.writeFile(output, buffer);
  return output;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw createError(response.status, data?.detail || data?.message || `Upstream HTTP ${response.status}`);
  }
  return data;
}

function runPythonJson(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('python', args, {
      cwd: ROOT,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8'
      }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(createError(500, error.message));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(createError(500, stderr.trim() || stdout.trim() || `Python exited with code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(createError(500, stdout.trim() || 'Invalid JSON from Python helper.'));
      }
    });
  });
}

function parseBooleanField(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function appendManagedServerLog(prefix, chunk) {
  const lines = String(chunk || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => `${prefix}${line}`);
  if (lines.length === 0) return;
  managedGenieServerLogTail.push(...lines);
  if (managedGenieServerLogTail.length > 120) {
    managedGenieServerLogTail = managedGenieServerLogTail.slice(-120);
  }
}

function getManagedServerStatus() {
  const running = Boolean(managedGenieServerProcess && !managedGenieServerProcess.killed && managedGenieServerProcess.exitCode === null);
  return {
    running,
    pid: running ? managedGenieServerProcess.pid : null,
    config: managedGenieServerConfig,
    logTail: managedGenieServerLogTail.slice(-40),
  };
}

async function waitForServerReady(serverUrl, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${serverUrl}/openapi.json`);
      if (response.ok) {
        return true;
      }
    } catch {
      // Keep polling until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function stopManagedGenieServer() {
  if (!managedGenieServerProcess || managedGenieServerProcess.exitCode !== null || managedGenieServerProcess.killed) {
    managedGenieServerProcess = null;
    managedGenieServerConfig = null;
    return;
  }

  const proc = managedGenieServerProcess;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {}
      resolve();
    }, 5000);

    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });

    try {
      proc.kill('SIGTERM');
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });

  managedGenieServerProcess = null;
  managedGenieServerConfig = null;
}

async function startManagedGenieServer({
  provider = 'cuda',
  enableConv1dPadToNc1d = false,
  serverUrl,
}) {
  await stopManagedGenieServer();
  managedGenieServerLogTail = [];

  const parsedUrl = new URL(normalizeServerUrl(serverUrl || DEFAULT_UPSTREAM_SERVER_URL));
  const host = parsedUrl.hostname;
  const port = Number(parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80));
  const args = ['genie_compat_api.py', '--provider', provider, '--host', host, '--port', String(port), '--download-default-model'];
  if (enableConv1dPadToNc1d) {
    args.push('--enable-cudnn-conv1d-pad-to-nc1d');
  }

  const child = spawn('python', args, {
    cwd: ROOT,
    env: {
      ...process.env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8'
    },
    windowsHide: true
  });

  managedGenieServerProcess = child;
  managedGenieServerConfig = {
    provider,
    enableConv1dPadToNc1d,
    serverUrl: parsedUrl.toString().replace(/\/$/, ''),
    args,
  };

  child.stdout.on('data', (data) => appendManagedServerLog('[stdout] ', data));
  child.stderr.on('data', (data) => appendManagedServerLog('[stderr] ', data));
  child.on('exit', (code, signal) => {
    appendManagedServerLog('[proc] ', `Genie server exited (code=${code}, signal=${signal})`);
    if (managedGenieServerProcess === child) {
      managedGenieServerProcess = null;
      managedGenieServerConfig = null;
    }
  });

  const ready = await waitForServerReady(managedGenieServerConfig.serverUrl, 15000);
  if (!ready) {
    await stopManagedGenieServer();
    throw createError(500, 'Managed Genie server did not become ready in time.');
  }

  return getManagedServerStatus();
}

function sanitizeVoiceId(rawValue) {
  const normalized = String(rawValue || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'voice';
}

function inferLanguageFromText(text, fallback = DEFAULT_REFERENCE_LANGUAGE) {
  const value = String(text || '').trim();
  if (!value) return fallback;
  if (/[\u3040-\u30ff]/.test(value)) return 'Japanese';
  if (/[\uac00-\ud7af]/.test(value)) return 'Korean';
  if (/[\u4e00-\u9fff]/.test(value)) return 'Chinese';
  if (/[àâçéèêëîïôûùüÿœæ]/i.test(value)) return 'French';
  if (/[äöüß]/i.test(value)) return 'German';
  if (/[áéíóúñ¿¡]/i.test(value)) return 'Spanish';
  if (/[ãõç]/i.test(value)) return 'Portuguese';
  return 'English';
}

function mapWhisperLanguageToLabel(code, fallback = DEFAULT_REFERENCE_LANGUAGE) {
  const normalized = String(code || '').trim().toLowerCase();
  const mapping = {
    en: 'English',
    english: 'English',
    ja: 'Japanese',
    japanese: 'Japanese',
    zh: 'Chinese',
    chinese: 'Chinese',
    ko: 'Korean',
    korean: 'Korean',
    fr: 'French',
    french: 'French',
    de: 'German',
    german: 'German',
    es: 'Spanish',
    spanish: 'Spanish',
    pt: 'Portuguese',
    portuguese: 'Portuguese',
    it: 'Italian',
    italian: 'Italian',
    ru: 'Russian',
    russian: 'Russian'
  };
  return mapping[normalized] || fallback;
}

async function transcribeReferenceAudio(audioPath) {
  const data = await runPythonJson([
    'transcribe_reference.py',
    '--audio',
    audioPath,
    '--model',
    'small',
    '--device',
    'cpu',
    '--compute-type',
    'int8'
  ]);

  const text = String(data?.text || '').trim();
  if (!text) {
    throw createError(500, 'Reference transcription returned empty text.');
  }

  return {
    text,
    language: mapWhisperLanguageToLabel(data?.language, inferLanguageFromText(text))
  };
}

async function safeReadJson(filePath, fallback = null) {
  try {
    const text = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function getVoiceResponse(preset, activeVoiceId) {
  return {
    id: preset.id,
    name: preset.name,
    active: preset.id === activeVoiceId,
    language: preset.referenceLanguage || DEFAULT_REFERENCE_LANGUAGE,
    has_ref_text: Boolean(preset.referenceText),
    x_vector_only_mode: Boolean(preset.xVectorOnlyMode),
    built_in: Boolean(preset.builtIn),
    created_at: preset.createdAt || null,
    updated_at: preset.updatedAt || null
  };
}

function ensureVoiceIdUnique(desiredId, items, excludeId = null) {
  const used = new Set(
    items
      .map((item) => String(item?.id || '').trim().toLowerCase())
      .filter((id) => id && id !== String(excludeId || '').trim().toLowerCase())
  );

  const base = sanitizeVoiceId(desiredId);
  if (!used.has(base)) return base;

  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function normalizeStoredPath(rawValue) {
  const value = String(rawValue || '').trim();
  return value ? path.resolve(value) : '';
}

function normalizeVoicePreset(rawPreset, existingPreset = null) {
  const now = new Date().toISOString();
  return {
    id: String(rawPreset.id || existingPreset?.id || '').trim(),
    name: String(rawPreset.name || existingPreset?.name || '').trim(),
    characterName: String(rawPreset.characterName || existingPreset?.characterName || '').trim(),
    modelDir: normalizeStoredPath(rawPreset.modelDir || existingPreset?.modelDir),
    proPlusModelDir: rawPreset.proPlusModelDir || existingPreset?.proPlusModelDir
      ? normalizeStoredPath(rawPreset.proPlusModelDir || existingPreset?.proPlusModelDir)
      : null,
    useV2ProPlus: Boolean(rawPreset.useV2ProPlus ?? existingPreset?.useV2ProPlus ?? true),
    referenceAudioPath: normalizeStoredPath(rawPreset.referenceAudioPath || existingPreset?.referenceAudioPath),
    referenceText: String(rawPreset.referenceText || existingPreset?.referenceText || '').trim(),
    referenceLanguage: String(
      rawPreset.referenceLanguage ||
      existingPreset?.referenceLanguage ||
      inferLanguageFromText(rawPreset.referenceText || existingPreset?.referenceText || '')
    ).trim() || DEFAULT_REFERENCE_LANGUAGE,
    xVectorOnlyMode: Boolean(rawPreset.xVectorOnlyMode ?? existingPreset?.xVectorOnlyMode ?? false),
    builtIn: Boolean(rawPreset.builtIn ?? existingPreset?.builtIn ?? false),
    source: String(rawPreset.source || existingPreset?.source || 'custom').trim(),
    uploadedFilePath: rawPreset.uploadedFilePath || existingPreset?.uploadedFilePath || null,
    createdAt: existingPreset?.createdAt || rawPreset.createdAt || now,
    updatedAt: now
  };
}

async function resolveDefaultMikaPreset() {
  for (const characterDir of DEFAULT_MIKA_CHARACTER_CANDIDATES) {
    const normalizedCharacterDir = path.resolve(characterDir);
    const modelDir = path.join(normalizedCharacterDir, 'tts_models');
    const promptJsonPath = path.join(normalizedCharacterDir, 'prompt_wav.json');
    const promptDir = path.join(normalizedCharacterDir, 'prompt_wav');

    if (!exists(promptJsonPath) || (!isValidGenieV2ProPlusDir(modelDir) && !isValidGenieV2Dir(modelDir))) {
      continue;
    }

    const promptJson = await safeReadJson(promptJsonPath, {});
    const normalPrompt = promptJson?.Normal || Object.values(promptJson || {})[0];
    const promptWaveName = String(normalPrompt?.wav || '').trim();
    const referenceAudioPath = promptWaveName ? path.join(promptDir, promptWaveName) : '';
    const referenceText = String(normalPrompt?.text || '').trim();

    if (!referenceAudioPath || !exists(referenceAudioPath) || !referenceText) {
      continue;
    }

    return normalizeVoicePreset({
      id: 'mika',
      name: 'Mika',
      characterName: 'mika',
      modelDir,
      proPlusModelDir: exists(DEFAULT_GENIE_PROPLUS_DIR) ? DEFAULT_GENIE_PROPLUS_DIR : null,
      useV2ProPlus: isValidGenieV2ProPlusDir(modelDir),
      referenceAudioPath,
      referenceText,
      referenceLanguage: inferLanguageFromText(referenceText, 'Japanese'),
      builtIn: true,
      source: 'builtin'
    });
  }

  return null;
}

async function saveVoicePresetState() {
  if (!voicePresetState) return;
  await ensureDir(DATA_DIR);
  await fsp.writeFile(VOICE_PRESETS_FILE, JSON.stringify(voicePresetState, null, 2), 'utf8');
}

async function loadVoicePresetState() {
  if (voicePresetState) return voicePresetState;

  await ensureDir(DATA_DIR);
  await ensureDir(VOICE_UPLOADS_DIR);

  const fileState = await safeReadJson(VOICE_PRESETS_FILE, {});
  const items = Array.isArray(fileState?.items) ? fileState.items : [];
  const normalizedItems = items
    .map((item) => normalizeVoicePreset(item))
    .filter((item) => item.id && item.name && item.characterName && item.modelDir && item.referenceAudioPath);

  const defaultMika = await resolveDefaultMikaPreset();
  let didChange = false;

  if (defaultMika) {
    const existingIndex = normalizedItems.findIndex((item) => item.id === defaultMika.id);
    if (existingIndex >= 0) {
      const existingItem = normalizedItems[existingIndex];
      normalizedItems[existingIndex] = normalizeVoicePreset(defaultMika, existingItem);
    } else {
      normalizedItems.unshift(defaultMika);
    }
    didChange = true;
  }

  let activeVoiceId = String(fileState?.activeVoiceId || '').trim();
  if (!normalizedItems.some((item) => item.id === activeVoiceId)) {
    activeVoiceId = defaultMika?.id || normalizedItems[0]?.id || '';
    didChange = true;
  }

  voicePresetState = {
    version: 1,
    activeVoiceId,
    items: normalizedItems
  };

  if (didChange || !exists(VOICE_PRESETS_FILE)) {
    await saveVoicePresetState();
  }

  return voicePresetState;
}

async function getActiveVoicePreset() {
  const state = await loadVoicePresetState();
  const preset = state.items.find((item) => item.id === state.activeVoiceId) || state.items[0] || null;
  if (!preset) {
    throw createError(404, 'No Genie voice presets are available.');
  }
  return preset;
}

async function getVoicePresetById(voiceId) {
  const state = await loadVoicePresetState();
  const normalizedId = String(voiceId || '').trim();
  const preset = state.items.find((item) => item.id === normalizedId);
  if (!preset) {
    throw createError(404, `Voice preset not found: ${normalizedId || '(empty id)'}`);
  }
  return preset;
}

async function getDefaultCloneBasePreset() {
  try {
    return await getVoicePresetById('mika');
  } catch {
    return getActiveVoicePreset();
  }
}

async function upsertVoicePreset(rawPreset, { activate = false } = {}) {
  const state = await loadVoicePresetState();
  const existingIndex = state.items.findIndex((item) => item.id === rawPreset.id);
  const existingPreset = existingIndex >= 0 ? state.items[existingIndex] : null;
  const normalized = normalizeVoicePreset(rawPreset, existingPreset);

  if (existingIndex >= 0) {
    state.items[existingIndex] = normalized;
  } else {
    state.items.push(normalized);
  }

  if (activate || !state.activeVoiceId) {
    state.activeVoiceId = normalized.id;
  }

  await saveVoicePresetState();
  return normalized;
}

async function deleteVoicePresetById(voiceId) {
  const state = await loadVoicePresetState();
  const normalizedId = String(voiceId || '').trim();
  const index = state.items.findIndex((item) => item.id === normalizedId);
  if (index < 0) {
    throw createError(404, `Voice preset not found: ${normalizedId || '(empty id)'}`);
  }

  const preset = state.items[index];
  if (preset.builtIn) {
    throw createError(400, 'Built-in Genie presets cannot be deleted.');
  }

  state.items.splice(index, 1);
  if (state.activeVoiceId === normalizedId) {
    state.activeVoiceId = state.items[0]?.id || '';
  }

  if (preset.uploadedFilePath) {
    await fsp.rm(path.dirname(preset.uploadedFilePath), { recursive: true, force: true }).catch(() => {});
  }

  await saveVoicePresetState();
}

let currentPreparedVoice = {
  serverUrl: '',
  voiceId: '',
  targetLanguage: '',
  referenceFingerprint: ''
};

function buildReferenceFingerprint(preset) {
  return JSON.stringify([
    preset.id,
    preset.referenceAudioPath,
    preset.referenceText,
    preset.referenceLanguage,
    preset.updatedAt
  ]);
}

async function ensureVoiceReady(serverUrl, preset, targetLanguage) {
  const runtime = await prepareRuntimeModelDir(
    preset.modelDir,
    preset.proPlusModelDir || DEFAULT_GENIE_PROPLUS_DIR,
    Boolean(preset.useV2ProPlus)
  );

  const shouldReloadCharacter =
    currentPreparedVoice.serverUrl !== serverUrl ||
    currentPreparedVoice.voiceId !== preset.id ||
    currentPreparedVoice.targetLanguage !== targetLanguage;

  if (shouldReloadCharacter) {
    await fetchJson(`${serverUrl}/load_character`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        character_name: preset.characterName,
        onnx_model_dir: runtime.runtimeModelDir,
        language: targetLanguage
      })
    });

    currentPreparedVoice = {
      serverUrl,
      voiceId: preset.id,
      targetLanguage,
      referenceFingerprint: ''
    };
  }

  const referenceFingerprint = buildReferenceFingerprint(preset);
  if (currentPreparedVoice.referenceFingerprint !== referenceFingerprint) {
    await fetchJson(`${serverUrl}/set_reference_audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        character_name: preset.characterName,
        audio_path: preset.referenceAudioPath,
        audio_text: preset.referenceText,
        language: preset.referenceLanguage || DEFAULT_REFERENCE_LANGUAGE
      })
    });

    currentPreparedVoice.referenceFingerprint = referenceFingerprint;
  }

  return runtime;
}

function parseWaveData(buffer) {
  let offset = 12;
  let channels = 1;
  let sampleRate = GENIE_SAMPLE_RATE;
  let bitsPerSample = GENIE_BITS_PER_SAMPLE;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;

    if (chunkId === 'fmt ' && chunkSize >= 16) {
      channels = buffer.readUInt16LE(chunkDataOffset + 2);
      sampleRate = buffer.readUInt32LE(chunkDataOffset + 4);
      bitsPerSample = buffer.readUInt16LE(chunkDataOffset + 14);
    } else if (chunkId === 'data') {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0) {
    throw createError(500, 'Generated WAV is missing a data chunk.');
  }

  return {
    channels,
    sampleRate,
    bitsPerSample,
    pcmData: buffer.subarray(dataOffset, Math.min(buffer.length, dataOffset + dataSize))
  };
}

function pcm16ToFloat32LeBuffer(pcmData, channels = 1) {
  if (channels <= 1) {
    const sampleCount = Math.floor(pcmData.length / 2);
    const floatSamples = new Float32Array(sampleCount);
    for (let i = 0, byteOffset = 0; i < sampleCount; i += 1, byteOffset += 2) {
      let sample = (pcmData[byteOffset + 1] << 8) | pcmData[byteOffset];
      if (sample >= 0x8000) sample -= 0x10000;
      floatSamples[i] = sample / 32768;
    }
    return Buffer.from(floatSamples.buffer, floatSamples.byteOffset, floatSamples.byteLength);
  }

  const frameCount = Math.floor(pcmData.length / (2 * channels));
  const floatSamples = new Float32Array(frameCount);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    let sum = 0;
    const baseByteOffset = frameIndex * channels * 2;
    for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
      const byteOffset = baseByteOffset + channelIndex * 2;
      let sample = (pcmData[byteOffset + 1] << 8) | pcmData[byteOffset];
      if (sample >= 0x8000) sample -= 0x10000;
      sum += sample / 32768;
    }
    floatSamples[frameIndex] = sum / channels;
  }
  return Buffer.from(floatSamples.buffer, floatSamples.byteOffset, floatSamples.byteLength);
}

async function synthesizeGenieAudio(serverUrl, characterName, text, splitSentence = false) {
  const startedAt = Date.now();
  const response = await fetch(`${serverUrl}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      character_name: characterName,
      text,
      split_sentence: splitSentence,
      save_path: null
    })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw createError(response.status, data?.detail || `Upstream HTTP ${response.status}`);
  }

  let buffer = Buffer.from(await response.arrayBuffer());
  if (!isRiffWav(buffer)) {
    buffer = wrapPcm16LeAsWav(buffer);
  }

  return {
    buffer,
    elapsedMs: Date.now() - startedAt
  };
}

app.get('/v1/health', async (_req, res) => {
  try {
    const state = await loadVoicePresetState();
    let ok = true;
    let lastError = null;

    try {
      const response = await fetch(`${DEFAULT_UPSTREAM_SERVER_URL}/openapi.json`);
      if (!response.ok) {
        ok = false;
        lastError = `Genie upstream returned HTTP ${response.status}`;
      }
    } catch (error) {
      ok = false;
      lastError = error instanceof Error ? error.message : String(error);
    }

    res.json({
      ok,
      server_url: DEFAULT_UPSTREAM_SERVER_URL,
      active_voice_id: state.activeVoiceId || '',
      default_voice_id: 'mika',
      voice_count: state.items.length,
      last_error: lastError
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      last_error: error.message || 'Health check failed.'
    });
  }
});

app.get('/v1/voices', async (_req, res) => {
  try {
    const state = await loadVoicePresetState();
    const items = [...state.items].sort((left, right) => {
      const leftScore = Number(left.id === state.activeVoiceId) * 10 + Number(left.builtIn) * 5;
      const rightScore = Number(right.id === state.activeVoiceId) * 10 + Number(right.builtIn) * 5;
      if (leftScore !== rightScore) return rightScore - leftScore;
      return left.name.localeCompare(right.name);
    });

    res.json({
      ok: true,
      items: items.map((item) => getVoiceResponse(item, state.activeVoiceId)),
      active_voice_id: state.activeVoiceId || ''
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to list voice presets.'
    });
  }
});

app.post('/v1/voices/select', async (req, res) => {
  try {
    const state = await loadVoicePresetState();
    const voiceId = String(req.body.voice_id || '').trim();
    if (!voiceId) {
      throw createError(400, 'voice_id is required.');
    }

    const preset = await getVoicePresetById(voiceId);
    state.activeVoiceId = preset.id;
    await saveVoicePresetState();

    res.json({
      ok: true,
      voice: getVoiceResponse(preset, state.activeVoiceId),
      active_voice_id: state.activeVoiceId
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to select voice preset.'
    });
  }
});

app.delete('/v1/voices/:id', async (req, res) => {
  try {
    await deleteVoicePresetById(req.params.id);
    const state = await loadVoicePresetState();
    res.json({
      ok: true,
      active_voice_id: state.activeVoiceId || ''
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to delete voice preset.'
    });
  }
});

app.post('/v1/voices/upload', upload.single('audio_file'), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) {
      throw createError(400, 'Voice name is required.');
    }
    if (!req.file) {
      throw createError(400, 'audio_file is required.');
    }

    const state = await loadVoicePresetState();
    const requestedId = String(req.body.voice_id || '').trim() || name;
    const voiceId = ensureVoiceIdUnique(requestedId, state.items);
    const activate = parseBooleanField(req.body.activate, true);
    const xVectorOnlyMode = parseBooleanField(req.body.x_vector_only_mode, false);
    const basePreset = await getDefaultCloneBasePreset();

    const extension = path.extname(req.file.originalname || '').toLowerCase() || '.wav';
    const voiceDir = path.join(VOICE_UPLOADS_DIR, voiceId);
    await ensureDir(voiceDir);
    const savedAudioPath = path.join(voiceDir, `reference${extension}`);
    await fsp.writeFile(savedAudioPath, req.file.buffer);

    let referenceText = String(req.body.ref_text || '').trim();
    let referenceLanguage = inferLanguageFromText(referenceText, DEFAULT_REFERENCE_LANGUAGE);
    if (!referenceText) {
      const transcription = await transcribeReferenceAudio(savedAudioPath);
      referenceText = transcription.text;
      referenceLanguage = transcription.language;
    }

    const preset = await upsertVoicePreset({
      id: voiceId,
      name,
      characterName: basePreset.characterName,
      modelDir: basePreset.modelDir,
      proPlusModelDir: basePreset.proPlusModelDir,
      useV2ProPlus: basePreset.useV2ProPlus,
      referenceAudioPath: savedAudioPath,
      referenceText,
      referenceLanguage,
      xVectorOnlyMode,
      uploadedFilePath: savedAudioPath,
      source: 'upload'
    }, { activate });

    const updatedState = await loadVoicePresetState();
    res.json({
      ok: true,
      voice: getVoiceResponse(preset, updatedState.activeVoiceId),
      active_voice_id: updatedState.activeVoiceId || ''
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to upload voice preset.'
    });
  }
});

app.post('/v1/voices/register-path', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const referenceAudioPath = String(req.body.ref_audio || '').trim();
    if (!name) {
      throw createError(400, 'Voice name is required.');
    }
    if (!referenceAudioPath) {
      throw createError(400, 'ref_audio is required.');
    }
    if (!exists(referenceAudioPath)) {
      throw createError(400, `Reference audio path does not exist: ${referenceAudioPath}`);
    }

    const state = await loadVoicePresetState();
    const requestedId = String(req.body.voice_id || '').trim() || name;
    const voiceId = ensureVoiceIdUnique(requestedId, state.items);
    const activate = parseBooleanField(req.body.activate, true);
    const xVectorOnlyMode = parseBooleanField(req.body.x_vector_only_mode, false);
    const basePreset = await getDefaultCloneBasePreset();

    let referenceText = String(req.body.ref_text || '').trim();
    let referenceLanguage = inferLanguageFromText(referenceText, DEFAULT_REFERENCE_LANGUAGE);
    if (!referenceText) {
      const transcription = await transcribeReferenceAudio(referenceAudioPath);
      referenceText = transcription.text;
      referenceLanguage = transcription.language;
    }

    const preset = await upsertVoicePreset({
      id: voiceId,
      name,
      characterName: String(req.body.character_name || basePreset.characterName).trim() || basePreset.characterName,
      modelDir: String(req.body.model_dir || basePreset.modelDir).trim() || basePreset.modelDir,
      proPlusModelDir: String(req.body.pro_plus_model_dir || basePreset.proPlusModelDir || '').trim() || basePreset.proPlusModelDir,
      useV2ProPlus: req.body.use_v2_proplus === undefined
        ? basePreset.useV2ProPlus
        : parseBooleanField(req.body.use_v2_proplus, basePreset.useV2ProPlus),
      referenceAudioPath,
      referenceText,
      referenceLanguage,
      xVectorOnlyMode,
      source: 'path'
    }, { activate });

    const updatedState = await loadVoicePresetState();
    res.json({
      ok: true,
      voice: getVoiceResponse(preset, updatedState.activeVoiceId),
      active_voice_id: updatedState.activeVoiceId || ''
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to register voice preset.'
    });
  }
});

app.post('/v1/tts/stream', async (req, res) => {
  try {
    const text = String(req.body.text || '').trim();
    const voiceId = String(req.body.voice_id || '').trim();
    const targetLanguage = String(req.body.language || 'English').trim() || 'English';
    if (!text) {
      throw createError(400, 'text is required.');
    }

    const preset = voiceId ? await getVoicePresetById(voiceId) : await getActiveVoicePreset();
    if (!preset.referenceAudioPath || !exists(preset.referenceAudioPath)) {
      throw createError(400, `Reference audio is missing for voice preset "${preset.name}".`);
    }

    await ensureVoiceReady(DEFAULT_UPSTREAM_SERVER_URL, preset, targetLanguage);
    const synthesis = await synthesizeGenieAudio(
      DEFAULT_UPSTREAM_SERVER_URL,
      preset.characterName,
      text,
      parseBooleanField(req.body.split_sentence, false)
    );

    const waveData = parseWaveData(synthesis.buffer);
    if (waveData.bitsPerSample !== 16) {
      throw createError(500, `Unsupported Genie output bit depth: ${waveData.bitsPerSample}`);
    }

    const floatBuffer = pcm16ToFloat32LeBuffer(waveData.pcmData, waveData.channels);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Qwen-Sample-Rate', String(waveData.sampleRate));
    res.setHeader('X-Genie-Voice-Id', preset.id);
    res.setHeader('X-Genie-Elapsed-Ms', String(synthesis.elapsedMs));
    res.send(floatBuffer);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Genie streaming synthesis failed.'
    });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    const serverUrl = normalizeServerUrl(req.query.serverUrl || 'http://127.0.0.1:8000');
    const response = await fetch(`${serverUrl}/openapi.json`);
    if (!response.ok) {
      throw createError(response.status, `Genie server returned HTTP ${response.status}`);
    }
    const openApi = await response.json().catch(() => ({}));
    res.json({
      ok: true,
      serverUrl,
      title: openApi.info?.title || 'Genie-TTS API',
      defaultModelDir: getDefaultModelDir(),
      defaultProPlusDir: exists(DEFAULT_GENIE_PROPLUS_DIR) ? DEFAULT_GENIE_PROPLUS_DIR : null
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Genie server health check failed.'
    });
  }
});

app.get('/api/server/status', async (_req, res) => {
  res.json({
    ok: true,
    ...getManagedServerStatus()
  });
});

app.post('/api/server/start', async (req, res) => {
  try {
    const serverUrl = normalizeServerUrl(req.body?.serverUrl || DEFAULT_UPSTREAM_SERVER_URL);
    const provider = String(req.body?.provider || 'cuda').trim() || 'cuda';
    if (!['cuda', 'cpu', 'auto', 'tensorrt'].includes(provider)) {
      throw createError(400, `Unsupported provider: ${provider}`);
    }

    const status = await startManagedGenieServer({
      provider,
      enableConv1dPadToNc1d: parseBooleanField(req.body?.enableConv1dPadToNc1d, false),
      serverUrl,
    });

    res.json({
      ok: true,
      ...status,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to start managed Genie server.'
    });
  }
});

app.post('/api/server/stop', async (_req, res) => {
  try {
    await stopManagedGenieServer();
    res.json({
      ok: true,
      ...getManagedServerStatus()
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to stop managed Genie server.'
    });
  }
});

app.get('/api/find-models', async (_req, res) => {
  try {
    const items = await findGenieModelDirs();
    res.json({
      ok: true,
      items
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to search for Genie model folders.'
    });
  }
});

app.get('/api/find-characters', async (_req, res) => {
  try {
    const items = await findGenieCharacters();
    res.json({
      ok: true,
      items
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to search for Genie characters.'
    });
  }
});

app.post('/api/load-character', async (req, res) => {
  try {
    const serverUrl = normalizeServerUrl(req.body.serverUrl);
    const modelDir = String(req.body.modelDir || '').trim();
    const proPlusModelDir = String(req.body.proPlusModelDir || '').trim();
    const useV2ProPlus = Boolean(req.body.useV2ProPlus);
    const runtime = await prepareRuntimeModelDir(
      modelDir,
      proPlusModelDir || DEFAULT_GENIE_PROPLUS_DIR,
      useV2ProPlus
    );
    const payload = {
      character_name: String(req.body.characterName || '').trim(),
      onnx_model_dir: runtime.runtimeModelDir,
      language: String(req.body.language || '').trim()
    };

    if (!payload.character_name || !modelDir || !payload.language) {
      throw createError(400, 'Character name, model folder, and language are required.');
    }

    const data = await fetchJson(`${serverUrl}/load_character`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    res.json({
      ok: true,
      runtimeModelDir: runtime.runtimeModelDir,
      runtimeMode: runtime.mode,
      ...data
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to load character.'
    });
  }
});

app.post('/api/unload-character', async (req, res) => {
  try {
    const serverUrl = normalizeServerUrl(req.body.serverUrl);
    const character_name = String(req.body.characterName || '').trim();
    if (!character_name) {
      throw createError(400, 'Character name is required.');
    }

    const data = await fetchJson(`${serverUrl}/unload_character`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character_name })
    });

    res.json({ ok: true, ...data });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to unload character.'
    });
  }
});

app.post('/api/clear-reference-cache', async (req, res) => {
  try {
    const serverUrl = normalizeServerUrl(req.body.serverUrl);
    const data = await fetchJson(`${serverUrl}/clear_reference_audio_cache`, {
      method: 'POST'
    });
    res.json({ ok: true, ...data });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to clear reference cache.'
    });
  }
});

app.post('/api/stop', async (req, res) => {
  try {
    const serverUrl = normalizeServerUrl(req.body.serverUrl);
    const data = await fetchJson(`${serverUrl}/stop`, {
      method: 'POST'
    });
    res.json({ ok: true, ...data });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to stop playback.'
    });
  }
});

app.post('/api/set-reference-audio', upload.single('reference'), async (req, res) => {
  let tempAudioPath = null;

  try {
    const serverUrl = normalizeServerUrl(req.body.serverUrl);
    const character_name = String(req.body.characterName || '').trim();
    const audio_text = String(req.body.audioText || '').trim();
    const language = String(req.body.language || '').trim();

    if (!character_name || !audio_text || !language) {
      throw createError(400, 'Character name, reference text, and language are required.');
    }

    if (!req.file) {
      throw createError(400, 'Reference audio file is required.');
    }

    tempAudioPath = await writeTempFile(req.file.buffer, req.file.originalname || 'reference.wav');

    const data = await fetchJson(`${serverUrl}/set_reference_audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        character_name,
        audio_path: tempAudioPath,
        audio_text,
        language
      })
    });

    res.json({
      ok: true,
      tempAudioPath,
      ...data
    });
  } catch (error) {
    if (tempAudioPath) {
      await fsp.rm(tempAudioPath, { force: true }).catch(() => {});
    }
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to set reference audio.'
    });
  }
});

app.post('/api/transcribe-reference', upload.single('reference'), async (req, res) => {
  let tempAudioPath = null;

  try {
    if (!req.file) {
      throw createError(400, 'Reference audio file is required.');
    }

    tempAudioPath = await writeTempFile(req.file.buffer, req.file.originalname || 'reference.wav');
    const model = String(req.body.whisperModel || 'small').trim() || 'small';
    const language = String(req.body.whisperLanguage || '').trim();

    const data = await runPythonJson([
      'transcribe_reference.py',
      '--audio',
      tempAudioPath,
      '--model',
      model,
      '--device',
      'cpu',
      '--compute-type',
      'int8',
      ...(language ? ['--language', language] : [])
    ]);

    res.json({
      ok: true,
      ...data
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Reference transcription failed.'
    });
  } finally {
    if (tempAudioPath) {
      await fsp.rm(tempAudioPath, { force: true }).catch(() => {});
    }
  }
});

app.post('/api/split-text', async (req, res) => {
  try {
    const text = String(req.body.text || '').trim();
    const maxLen = Math.max(1, Math.min(200, Number(req.body.maxLen || 40)));
    const minLen = Math.max(1, Math.min(maxLen, Number(req.body.minLen || 5)));

    if (!text) {
      throw createError(400, 'Text is required.');
    }

    const data = await runPythonJson([
      'split_text.py',
      '--text',
      text,
      '--max-len',
      String(maxLen),
      '--min-len',
      String(minLen)
    ]);

    res.json({
      ok: true,
      ...data
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Text split failed.'
    });
  }
});

app.post('/api/tts', async (req, res) => {
  try {
    const serverUrl = normalizeServerUrl(req.body.serverUrl);
    const payload = {
      character_name: String(req.body.characterName || '').trim(),
      text: String(req.body.text || '').trim(),
      split_sentence: Boolean(req.body.splitSentence),
      save_path: null
    };

    if (!payload.character_name || !payload.text) {
      throw createError(400, 'Character name and target text are required.');
    }

    const startedAt = Date.now();
    const response = await fetch(`${serverUrl}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw createError(response.status, data?.detail || `Upstream HTTP ${response.status}`);
    }

    let buffer = Buffer.from(await response.arrayBuffer());
    if (!isRiffWav(buffer)) {
      buffer = wrapPcm16LeAsWav(buffer);
    }

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('X-Genie-Elapsed-Ms', String(Date.now() - startedAt));
    res.send(buffer);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Genie synthesis failed.'
    });
  }
});

app.listen(PORT, () => {
  ensureTmpDir();
  console.log(`Genie-TTS test UI running at http://localhost:${PORT}`);
});
