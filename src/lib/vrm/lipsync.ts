import type { VRM } from '@pixiv/three-vrm';
import type { TtsManager } from '../tts/manager.js';

export const PHONEME_TO_BLEND_SHAPE: Record<string, Record<string, number>> = {
	// Vowels
	'\u0259': { aa: 0.5, ih: 0.2 },
	'\u00e6': { aa: 0.7 },
	a: { aa: 0.8 },
	'\u0251': { aa: 1.0 },
	'\u0252': { oh: 0.45, ou: 0.2 },
	'\u0254': { oh: 0.55, ou: 0.25 },
	o: { oh: 0.5, ou: 0.2 },
	'\u028a': { ou: 0.7 },
	u: { ou: 1.0 },
	'\u028c': { aa: 0.5, oh: 0.3 },
	'\u026a': { ih: 0.6 },
	i: { ee: 0.8, ih: 0.3 },
	e: { ee: 0.7, ih: 0.2 },
	'\u025b': { ee: 0.6, ih: 0.3 },
	'\u025c': { aa: 0.5, oh: 0.3 },
	'\u0250': { aa: 0.6 },
	// Consonants
	f: { ih: 0.3 },
	v: { ih: 0.3 },
	'\u03b8': { ih: 0.4 },
	'\u00f0': { ih: 0.4 },
	s: { ih: 0.4 },
	z: { ee: 0.4 },
	'\u0283': { ou: 0.4 },
	'\u0292': { ou: 0.4 },
	t: { ih: 0.3 },
	d: { ih: 0.3 },
	n: { ih: 0.3 },
	l: { ih: 0.3 },
	'\u0279': { ou: 0.4 },
	w: { ou: 0.6 },
	j: { ee: 0.4 },
	p: { aa: 0.3 },
	b: { aa: 0.3 },
	m: { aa: 0.3 },
	k: { aa: 0.4 },
	'\u0261': { aa: 0.4 },
	'\u014b': { aa: 0.3 },
	h: { aa: 0.2 },
	'\u027e': { ih: 0.3 },
	't\u0283': { ou: 0.4 },
	'd\u0292': { ou: 0.4 }
};

let previousAa = 0;
let previousIh = 0;
let previousOu = 0;
let previousEe = 0;
let previousOh = 0;

// Baseline tuning inspired by WEBWAIFUV2 defaults.
const MOUTH_SMOOTHING = 0.56;
const PHONEME_GAIN = 0.39;

function clamp01(value: number): number {
	return Math.min(Math.max(value, 0), 1);
}

// Cache cleaned phoneme arrays to avoid regex + split + filter every frame
const phonemeCache = new Map<string, string[]>();
function getCleanPhonemes(raw: string): string[] {
	let cached = phonemeCache.get(raw);
	if (!cached) {
		cached = raw
			.replace(/[\u02c8\u02cc\u02d0\u02d1\u032f\u0329\u0306\u0303\u0300\u0301\u0302\u0304]/g, '')
			.replace(/[,.!?]/g, '')
			.split('')
			.filter((c: string) => c.trim().length > 0);
		phonemeCache.set(raw, cached);
		if (phonemeCache.size > 500) {
			const first = phonemeCache.keys().next().value;
			if (first !== undefined) phonemeCache.delete(first);
		}
	}
	return cached;
}

export function updateLipSync(vrm: VRM | null, ttsManager: TtsManager) {
	if (!vrm || !vrm.expressionManager) return;

	const manager = vrm.expressionManager;
	const hasHtmlAudio = !!ttsManager.currentAudio;
	const isHtmlAudioActive = hasHtmlAudio
		? !ttsManager.currentAudio!.paused && !ttsManager.currentAudio!.ended
		: false;
	const isPlaybackActive = isHtmlAudioActive || ttsManager.isPlaying;

	if (!isPlaybackActive) {
		manager.setValue('aa', 0);
		manager.setValue('ih', 0);
		manager.setValue('ou', 0);
		manager.setValue('ee', 0);
		manager.setValue('oh', 0);
		previousAa = previousIh = previousOu = previousEe = previousOh = 0;
		return;
	}

	// Read MFCC weights before hard-gating so we can keep lips moving
	// even when analyser amplitude is temporarily low.
	const mfccWeights = ttsManager.getLipSyncWeights();
	const mfccEnergy = mfccWeights
		? (mfccWeights.A + mfccWeights.I + mfccWeights.U + mfccWeights.E + mfccWeights.O)
		: 0;

	const audioAmplitude = ttsManager.getAudioAmplitude();
	const isAudioActive = audioAmplitude > 0.01 || mfccEnergy > 0.02;

	if (!isAudioActive) {
		manager.setValue('aa', 0);
		manager.setValue('ih', 0);
		manager.setValue('ou', 0);
		manager.setValue('ee', 0);
		manager.setValue('oh', 0);
		previousAa = previousIh = previousOu = previousEe = previousOh = 0;
		return;
	}

	const currentTime = isHtmlAudioActive
		? ttsManager.currentAudio!.currentTime
		: ttsManager.audioContext && ttsManager.wordBoundaryStartTime !== null
			? Math.max(0, ttsManager.audioContext.currentTime - ttsManager.wordBoundaryStartTime)
			: 0;
	let targetAa = 0,
		targetIh = 0,
		targetOu = 0,
		targetEe = 0,
		targetOh = 0;
	const phonemeGain = PHONEME_GAIN;

	const hasValidTiming =
		ttsManager.wordBoundaries &&
		ttsManager.wordBoundaries.length > 1 &&
		ttsManager.wordBoundaries.some((wb, i) => {
			if (i === 0) return false;
			const prevOffset = ttsManager.wordBoundaries[i - 1].offset || 0;
			const currOffset = wb.offset || 0;
			return currOffset > prevOffset;
		});

	let currentWordBoundary: (typeof ttsManager.wordBoundaries)[0] | null = null;
	let wordIndex = -1;
	if (hasValidTiming) {
		for (let i = 0; i < ttsManager.wordBoundaries.length; i++) {
			const wb = ttsManager.wordBoundaries[i];
			const wordStart = (wb.offset || 0) / 10000000;
			const wordEnd = wordStart + (wb.duration || 0) / 10000000;
			if (currentTime >= wordStart && currentTime <= wordEnd) {
				currentWordBoundary = wb;
				wordIndex = i;
				break;
			}
		}
	}

	let usedPhonemeMode = false;
	const useMfccMode = !!mfccWeights && mfccEnergy > 0.02;

	// wLipSync MFCC mode — real-time phoneme detection from audio signal
	if (useMfccMode) {
		// Normalize MFCC channels to avoid multiple strong visemes at once.
		const rawA = clamp01(mfccWeights.A);
		const rawI = clamp01(mfccWeights.I);
		const rawU = clamp01(mfccWeights.U);
		const rawE = clamp01(mfccWeights.E);
		const rawO = clamp01(mfccWeights.O);
		const rawTotal = rawA + rawI + rawU + rawE + rawO;
		const loudness = clamp01(rawTotal);
		const invTotal = rawTotal > 0.00001 ? 1 / rawTotal : 0;

		targetAa = rawA * invTotal * loudness * 1.45 * phonemeGain + audioAmplitude * 0.18;
		targetIh = rawI * invTotal * loudness * 1.2 * phonemeGain;
		targetOu = rawU * invTotal * loudness * 1.15 * phonemeGain;
		targetEe = rawE * invTotal * loudness * 1.25 * phonemeGain;

		// Keep O subtle and push some energy into ou (rounded lips without "surprised O").
		const oEnergy = rawO * invTotal * loudness;
		const oCompressed = Math.pow(clamp01(oEnergy), 1.2);
		targetOh = oCompressed * 0.34 * phonemeGain;
		targetOu += oCompressed * 0.24;
		targetAa *= 1 - oCompressed * 0.16;

		// Hybrid: blend gentle frequency detail on top.
		const bands = ttsManager.getFrequencyBands();
		if (bands) {
			const { low, midLow, midHigh } = bands;
			const blend = 0.06;
			targetAa += low * audioAmplitude * blend;
			targetOh += (low * 0.16 + midLow * 0.1) * audioAmplitude * blend;
			targetIh += midLow * audioAmplitude * blend * 0.6;
			targetEe += midHigh * audioAmplitude * blend * 0.65;
			targetOu += (midHigh * 0.45 + low * 0.2) * audioAmplitude * blend * 0.65;
		}

		// Clamp
		targetAa = Math.min(targetAa, 0.95);
		targetIh = Math.min(targetIh, 0.72);
		targetOu = Math.min(targetOu, 0.7);
		targetEe = Math.min(targetEe, 0.75);
		targetOh = Math.min(targetOh, 0.36);

		usedPhonemeMode = true;
	}

	// Phoneme mode (Kokoro — has word boundaries + phoneme data)
	// MFCC must stay authoritative when available to avoid timing drift.
	if (!useMfccMode && hasValidTiming && currentWordBoundary && ttsManager.currentPhonemes) {
		let wordPhonemes = '';
		if (Array.isArray(ttsManager.currentPhonemes)) {
			if (wordIndex >= 0 && wordIndex < ttsManager.currentPhonemes.length) {
				wordPhonemes = ttsManager.currentPhonemes[wordIndex];
			}
		}

		if (wordPhonemes) {
			const wordStart = (currentWordBoundary.offset || 0) / 10000000;
			const wordDuration = (currentWordBoundary.duration || 0) / 10000000;
			const timeInWord = Math.max(0, Math.min(1, (currentTime - wordStart) / wordDuration));

			const cleanPhonemes = getCleanPhonemes(wordPhonemes);

			if (cleanPhonemes.length > 0) {
				const acceleratedTime = Math.min(timeInWord * 1.5, 1.0);
				const phonemeIndex = Math.floor(acceleratedTime * cleanPhonemes.length);
				const currentPhoneme = cleanPhonemes[phonemeIndex] || cleanPhonemes[cleanPhonemes.length - 1];

				let phonemeKey = currentPhoneme;
				if (phonemeIndex < cleanPhonemes.length - 1) {
					const twoChar = currentPhoneme + cleanPhonemes[phonemeIndex + 1];
					if (PHONEME_TO_BLEND_SHAPE.hasOwnProperty(twoChar)) {
						phonemeKey = twoChar;
					}
				}

				const blendMap = PHONEME_TO_BLEND_SHAPE[phonemeKey] || {};
				targetAa = (blendMap.aa || 0) * phonemeGain;
				targetIh = (blendMap.ih || 0) * phonemeGain;
				targetOu = (blendMap.ou || 0) * phonemeGain;
				targetEe = (blendMap.ee || 0) * phonemeGain;
				targetOh = (blendMap.oh || 0) * phonemeGain;

				const hasMapping =
					targetAa > 0 || targetIh > 0 || targetOu > 0 || targetEe > 0 || targetOh > 0;

				if (hasMapping) {
					const effectiveAmplitude = Math.max(audioAmplitude, 0.22);
					const amplitudeMultiplier = Math.min(effectiveAmplitude * 1.7, 1.0);
					targetAa = Math.min(targetAa * amplitudeMultiplier + effectiveAmplitude * 0.24, 0.95);
					targetIh = Math.min(targetIh * amplitudeMultiplier + effectiveAmplitude * 0.15, 0.8);
					targetOu = Math.min(targetOu * amplitudeMultiplier + effectiveAmplitude * 0.15, 0.72);
					targetEe = Math.min(targetEe * amplitudeMultiplier + effectiveAmplitude * 0.15, 0.8);
					targetOh = Math.min(targetOh * amplitudeMultiplier + effectiveAmplitude * 0.1, 0.42);
					if (targetAa + targetIh + targetOu + targetEe + targetOh < 0.12) {
						targetAa = Math.max(targetAa, effectiveAmplitude * 0.3);
					}
					usedPhonemeMode = true;
				}
			}
		}
	}

	// Frequency-band viseme estimation (primary fallback — Fish Audio + any non-phoneme audio)
	// Maps FFT frequency bands to mouth shapes based on formant frequencies:
	//   Low band (0-860Hz)    → jaw open (aa/oh) — vocal fundamental + F1
	//   Mid-low (860-2150Hz)  → mid shapes (ih)  — F1-F2 transition
	//   Mid-high (2150-3440Hz)→ spread/round (ee/ou) — F2 region
	//   High (3440-6020Hz)    → fricatives (slight ih) — sibilance
	if (!usedPhonemeMode) {
		const bands = ttsManager.getFrequencyBands();

		if (bands) {
			const { low, midLow, midHigh, high } = bands;
			const total = low + midLow + midHigh + high;

			if (total > 0.05) {
				// Normalize bands relative to each other
				const nLow = low / total;
				const nMidLow = midLow / total;
				const nMidHigh = midHigh / total;
				const nHigh = high / total;

				// Map frequency distribution to visemes
				// aa: jaw open — dominated by low frequencies (open vowels like "ah", "aah")
				targetAa = Math.min(nLow * 1.4 * audioAmplitude * 2.0, 1.0);

				// oh: keep subtle and share roundness with ou.
				targetOh = Math.min((nLow * 0.35 + nMidLow * 0.2) * audioAmplitude * 1.3, 0.38);

				// ih: slight open — mid frequencies (vowels like "ih", "eh")
				targetIh = Math.min((nMidLow * 0.8 + nHigh * 0.4) * audioAmplitude * 1.6, 0.7);

				// ee: wide spread — high-mid frequencies (vowels like "ee", "ay")
				targetEe = Math.min(nMidHigh * 1.2 * audioAmplitude * 1.8, 0.7);

				// ou: rounded/pursed — mid balance (vowels like "oo", "ou")
				targetOu = Math.min((nMidHigh * 0.62 + nLow * 0.28) * audioAmplitude * 1.45 + targetOh * 0.28, 0.68);

				// Small cyclical redistribution across all 5 visemes for less robotic motion.
				const cycle = Math.sin(currentTime * 4.2) * 0.5 + 0.5;
				if (cycle < 0.2) targetAa *= 1.08;
				else if (cycle < 0.4) targetIh += audioAmplitude * 0.05;
				else if (cycle < 0.6) targetOu += audioAmplitude * 0.05;
				else if (cycle < 0.8) targetEe += audioAmplitude * 0.05;
				else targetOh += audioAmplitude * 0.03;

				// Ensure minimum mouth movement when audio is playing
				if (targetAa + targetIh + targetOu + targetEe + targetOh < 0.15) {
					targetAa = Math.max(audioAmplitude * 0.5, 0.15);
				}
			} else {
				// Very quiet — barely open
				targetAa = audioAmplitude * 0.3;
			}
		} else {
			// No frequency data available — simple amplitude-only fallback
			targetAa = audioAmplitude * 0.8;
			targetIh = audioAmplitude * 0.15;
		}
	}

	// Global anti-"surprised O" shaping:
	// keep roundness, but avoid exaggerated circular mouth.
	if (targetOh > 0) {
		const oSoft = Math.pow(clamp01(targetOh), 1.2);
		const maxOh = 0.3 + audioAmplitude * 0.14;
		targetOh = Math.min(oSoft, maxOh);
		targetOu = Math.min(targetOu + targetOh * 0.34, 0.74);
		targetAa *= 1 - targetOh * 0.18;
		targetEe *= 1 - targetOh * 0.45;

		const roundTotal = targetOh + targetOu;
		const roundCap = 0.62 + audioAmplitude * 0.12;
		if (roundTotal > roundCap) {
			const scale = roundCap / roundTotal;
			targetOh *= scale;
			targetOu *= scale;
		}
	}

	// Smooth transitions — higher value = smoother/slower mouth movement
	const smoothing = useMfccMode
		? Math.max(0.45, MOUTH_SMOOTHING - 0.08)
		: usedPhonemeMode
			? MOUTH_SMOOTHING
			: Math.min(0.7, MOUTH_SMOOTHING + 0.06);
	const smoothedAa = previousAa + (targetAa - previousAa) * (1 - smoothing);
	const smoothedIh = previousIh + (targetIh - previousIh) * (1 - smoothing);
	const smoothedOu = previousOu + (targetOu - previousOu) * (1 - smoothing);
	const smoothedEe = previousEe + (targetEe - previousEe) * (1 - smoothing);
	const smoothedOh = previousOh + (targetOh - previousOh) * (1 - smoothing);

	manager.setValue('aa', Math.min(Math.max(smoothedAa, 0), 1.0));
	manager.setValue('ih', Math.min(Math.max(smoothedIh, 0), 1.0));
	manager.setValue('ou', Math.min(Math.max(smoothedOu, 0), 1.0));
	manager.setValue('ee', Math.min(Math.max(smoothedEe, 0), 1.0));
	manager.setValue('oh', Math.min(Math.max(smoothedOh, 0), 1.0));

	previousAa = smoothedAa;
	previousIh = smoothedIh;
	previousOu = smoothedOu;
	previousEe = smoothedEe;
	previousOh = smoothedOh;
}

export function resetLipSync(vrm: VRM | null) {
	if (!vrm?.expressionManager) return;
	vrm.expressionManager.setValue('aa', 0);
	vrm.expressionManager.setValue('ih', 0);
	vrm.expressionManager.setValue('ou', 0);
	vrm.expressionManager.setValue('ee', 0);
	vrm.expressionManager.setValue('oh', 0);
	previousAa = previousIh = previousOu = previousEe = previousOh = 0;
}
