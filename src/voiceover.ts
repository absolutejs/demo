import type {
	AudioChunk,
	AudioFormat,
	TTSAdapter,
	TTSAdapterOpenOptions,
} from "@absolutejs/voice";
import type { DemoArtifact, DemoNarrationInput, DemoVoiceover } from "./types";

export type VoiceTTSVoiceoverOptions = {
	tts: TTSAdapter;
	outputDir: string;
	openOptions?: Partial<TTSAdapterOpenOptions>;
	filePrefix?: string;
	sessionId?: string;
};

export type DeepgramAuraVoiceoverOptions = {
	apiKey: string;
	outputDir: string;
	model?: string;
	baseUrl?: string;
	sampleRateHz?: 8000 | 16000 | 24000 | 48000;
	filePrefix?: string;
};

const toUint8Array = (chunk: AudioChunk): Uint8Array => {
	if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
	return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
};

const extensionFor = (format?: AudioFormat) => {
	if (!format) return "raw";
	if (format.encoding === "pcm_s16le") return "pcm";
	return format.encoding;
};

const durationMsForRawAudio = (
	bytes: Uint8Array,
	format: AudioFormat | undefined,
) => {
	if (!format) return undefined;
	const bytesPerSample = format.encoding === "pcm_s16le" ? 2 : 1;
	const samples = bytes.byteLength / bytesPerSample / format.channels;
	return Math.round((samples / format.sampleRateHz) * 1000);
};

export const createVoiceTTSVoiceover = (
	options: VoiceTTSVoiceoverOptions,
): DemoVoiceover => ({
	speak: async (input: DemoNarrationInput): Promise<DemoArtifact> => {
		const chunks: Uint8Array[] = [];
		let format: AudioFormat | undefined;
		const session = await options.tts.open({
			sessionId: options.sessionId ?? `demo-voiceover-${Date.now()}`,
			...options.openOptions,
			prosody: {
				...options.openOptions?.prosody,
				...(input.emotion ? { style: input.emotion } : {}),
			},
		});
		const offAudio = session.on("audio", (event) => {
			format = event.format;
			chunks.push(toUint8Array(event.chunk));
		});
		const errors: Error[] = [];
		const offError = session.on("error", (event) => {
			errors.push(event.error);
		});
		await session.send(input.text);
		await session.close("voiceover-complete");
		offAudio();
		offError();
		if (errors[0]) throw errors[0];
		const bytes = new Uint8Array(
			chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
		);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		const id = `${options.filePrefix ?? "voiceover"}-${Date.now()}`;
		const path = `${options.outputDir}/${id}.${extensionFor(format)}`;
		await Bun.write(path, bytes);
		return {
			id,
			kind: "voiceover",
			path,
			metadata: {
				durationMs: durationMsForRawAudio(bytes, format),
				format,
				text: input.text,
				voice: input.voice,
			},
		};
	},
});

// ElevenLabs runtime voice settings. Names mirror the ElevenLabs REST
// `voice_settings` block but stay camelCase to match the rest of this package;
// they are translated to snake_case at request time.
export type ElevenLabsVoiceSettings = {
	stability?: number;
	similarityBoost?: number;
	style?: number;
	speed?: number;
	useSpeakerBoost?: boolean;
};

export type ElevenLabsVoiceoverOptions = {
	apiKey: string;
	outputDir: string;
	voiceId?: string;
	modelId?: string;
	outputFormat?: string;
	voiceSettings?: ElevenLabsVoiceSettings;
	languageCode?: string;
	seed?: number;
	enableLogging?: boolean;
	baseUrl?: string;
	filePrefix?: string;
	fetchImpl?: typeof fetch;
	// Content-addressed cache directory. When set, audio is reused whenever the
	// full request hash (voice + model + format + settings + language + seed +
	// text) is unchanged — so identical narration is never re-generated and
	// never re-billed. Any change to an input yields a new hash and a re-render.
	cacheDir?: string;
};

// Rachel — the American ElevenLabs voice Dealroom settled on as the premium
// default for Boardy-style demos (see VOICE.md). Overridable per call via
// `input.voice` (an ElevenLabs voice id) or per instance via `options.voiceId`.
export const DEFAULT_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
export const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_flash_v2_5";
// mp3_44100_128 is CBR, so duration is derivable from byte length and the file
// drops straight into ffmpeg composition. Fidelity beats the realtime-tuned
// pcm_16000 default Dealroom uses for its live phone/browser path.
export const DEFAULT_ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";

// Tuned ElevenLabs settings from the Dealroom voice upgrade.
const DEFAULT_ELEVENLABS_VOICE_SETTINGS: Required<ElevenLabsVoiceSettings> = {
	similarityBoost: 0.78,
	speed: 1,
	stability: 0.42,
	style: 0.35,
	useSpeakerBoost: true,
};

// Narration emotion nudges the expressive controls. Lower stability + higher
// style reads as more animated; the inverse reads calmer and steadier. Only
// the two expressive dials move so a tuned base voice keeps its character.
const EMOTION_VOICE_SETTINGS: Record<
	NonNullable<DemoNarrationInput["emotion"]>,
	Partial<ElevenLabsVoiceSettings>
> = {
	calm: { stability: 0.6, style: 0.25 },
	confident: { stability: 0.5, style: 0.45 },
	excited: { stability: 0.3, style: 0.6 },
	neutral: {},
};

// FNV-1a (32-bit) over the key string. Not cryptographic — just a stable,
// dependency-free filename for content-addressed audio. Callers pair it with an
// exact-signature check, so a collision can never return the wrong audio.
const hashKey = (value: string): string => {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
};

const omitUndefined = <T extends Record<string, unknown>>(value: T): T =>
	Object.fromEntries(
		Object.entries(value).filter(([, entry]) => entry !== undefined),
	) as T;

// Duration from byte length. CBR mp3 (mp3_<rate>_<kbps>) and raw pcm/u-law/
// a-law are all computable; anything else (e.g. VBR) returns undefined so the
// sync layer can fall back instead of trusting a wrong number.
const durationMsForOutputFormat = (
	bytes: Uint8Array,
	outputFormat: string,
): number | undefined => {
	const mp3 = /^mp3_\d+_(\d+)$/.exec(outputFormat);
	if (mp3) {
		const kbps = Number(mp3[1]);
		if (!Number.isFinite(kbps) || kbps <= 0) return undefined;
		return Math.round((bytes.byteLength / ((kbps * 1000) / 8)) * 1000);
	}
	const pcm = /^pcm_(\d+)$/.exec(outputFormat);
	if (pcm) {
		const sampleRateHz = Number(pcm[1]);
		if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) return undefined;
		return Math.round((bytes.byteLength / 2 / sampleRateHz) * 1000);
	}
	const law = /^(?:u|a)law_(\d+)$/.exec(outputFormat);
	if (law) {
		const sampleRateHz = Number(law[1]);
		if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) return undefined;
		return Math.round((bytes.byteLength / sampleRateHz) * 1000);
	}
	return undefined;
};

const extensionForOutputFormat = (outputFormat: string) => {
	if (outputFormat.startsWith("mp3_")) return "mp3";
	if (outputFormat.startsWith("pcm_")) return "pcm";
	if (outputFormat.startsWith("ulaw_") || outputFormat.startsWith("alaw_"))
		return "raw";
	return "bin";
};

// Premium tier. ElevenLabs is the correct default for client demos (VOICE.md):
// Deepgram Aura is faster/cheaper but reads robotic. This calls the ElevenLabs
// REST endpoint directly (like the Aura path above) rather than the
// `@absolutejs/voice` adapter, because that adapter's audio contract is
// pcm-only and would force a fidelity downgrade for a rendered file.
export const createElevenLabsVoiceover = (
	options: ElevenLabsVoiceoverOptions,
): DemoVoiceover => ({
	speak: async (input: DemoNarrationInput): Promise<DemoArtifact> => {
		const text = input.text.trim();
		if (!text) {
			throw new Error("ElevenLabs voiceover text cannot be empty");
		}
		const outputFormat =
			options.outputFormat ?? DEFAULT_ELEVENLABS_OUTPUT_FORMAT;
		const voiceId =
			input.voice ?? options.voiceId ?? DEFAULT_ELEVENLABS_VOICE_ID;
		const modelId = options.modelId ?? DEFAULT_ELEVENLABS_MODEL_ID;
		const voiceSettings: Required<ElevenLabsVoiceSettings> = {
			...DEFAULT_ELEVENLABS_VOICE_SETTINGS,
			...options.voiceSettings,
			...(input.emotion ? EMOTION_VOICE_SETTINGS[input.emotion] : {}),
		};
		const extension = extensionForOutputFormat(outputFormat);
		// Full request signature — the cache key. Anything that changes the
		// audio changes this string (and thus the hash); anything unchanged
		// reuses the cached file and skips the (billed) API call.
		const cacheSignature = JSON.stringify({
			format: outputFormat,
			languageCode: options.languageCode ?? null,
			modelId,
			seed: options.seed ?? null,
			text,
			voiceId,
			voiceSettings,
		});
		const cacheHash = `${hashKey(cacheSignature)}-${text.length}`;
		if (options.cacheDir) {
			const manifestFile = Bun.file(`${options.cacheDir}/${cacheHash}.json`);
			if (await manifestFile.exists()) {
				const cached = (await manifestFile.json()) as {
					artifact: DemoArtifact;
					signature: string;
				};
				// Guard against hash collisions: only reuse on an exact
				// signature match.
				if (cached.signature === cacheSignature) return cached.artifact;
			}
		}
		const baseUrl = (options.baseUrl ?? "https://api.elevenlabs.io").replace(
			/\/$/,
			"",
		);
		const url = new URL(
			`${baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
		);
		url.searchParams.set("output_format", outputFormat);
		if (options.enableLogging !== undefined) {
			url.searchParams.set("enable_logging", String(options.enableLogging));
		}
		const fetchImpl = options.fetchImpl ?? fetch;
		const response = await fetchImpl(url.toString(), {
			body: JSON.stringify(
				omitUndefined({
					language_code: options.languageCode,
					model_id: modelId,
					seed: options.seed,
					text,
					voice_settings: omitUndefined({
						similarity_boost: voiceSettings.similarityBoost,
						speed: voiceSettings.speed,
						stability: voiceSettings.stability,
						style: voiceSettings.style,
						use_speaker_boost: voiceSettings.useSpeakerBoost,
					}),
				}),
			),
			headers: {
				"content-type": "application/json",
				"xi-api-key": options.apiKey,
			},
			method: "POST",
		});
		if (!response.ok) {
			const detail = (await response.text().catch(() => "")).slice(0, 500);
			throw new Error(
				`ElevenLabs voiceover failed (${response.status}): ${
					detail || response.statusText
				}`,
			);
		}
		const bytes = new Uint8Array(await response.arrayBuffer());
		const id = `${options.filePrefix ?? "voiceover"}-${Date.now()}`;
		// When caching, the audio file is content-addressed (named by hash) and
		// lives in the cache dir so it persists and is reused next run; otherwise
		// it's a one-off file in the output dir.
		const path = options.cacheDir
			? `${options.cacheDir}/${cacheHash}.${extension}`
			: `${options.outputDir}/${id}.${extension}`;
		await Bun.write(path, bytes);
		const artifact: DemoArtifact = {
			id,
			kind: "voiceover",
			metadata: {
				durationMs: durationMsForOutputFormat(bytes, outputFormat),
				model: modelId,
				outputFormat,
				provider: "elevenlabs",
				text,
				voice: voiceId,
				voiceSettings,
			},
			path,
		};
		if (options.cacheDir) {
			await Bun.write(
				`${options.cacheDir}/${cacheHash}.json`,
				JSON.stringify({ artifact, signature: cacheSignature }),
			);
		}
		return artifact;
	},
});

export const createDeepgramAuraVoiceover = (
	options: DeepgramAuraVoiceoverOptions,
): DemoVoiceover => ({
	speak: async (input: DemoNarrationInput): Promise<DemoArtifact> => {
		const text = input.text.trim();
		if (!text) {
			throw new Error("Deepgram Aura voiceover text cannot be empty");
		}
		const sampleRateHz = options.sampleRateHz ?? 24000;
		const baseUrl = (options.baseUrl ?? "https://api.deepgram.com").replace(
			/\/$/,
			"",
		);
		const model = input.voice ?? options.model ?? "aura-asteria-en";
		const url = `${baseUrl}/v1/speak?model=${encodeURIComponent(
			model,
		)}&encoding=linear16&sample_rate=${sampleRateHz}&container=none`;
		const response = await fetch(url, {
			body: JSON.stringify({ text }),
			headers: {
				authorization: `Token ${options.apiKey}`,
				"content-type": "application/json",
			},
			method: "POST",
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new Error(
				`Deepgram Aura voiceover failed (${response.status}): ${
					detail || response.statusText
				}`,
			);
		}
		const id = `${options.filePrefix ?? "voiceover"}-${Date.now()}`;
		const path = `${options.outputDir}/${id}.pcm`;
		const bytes = new Uint8Array(await response.arrayBuffer());
		const format: AudioFormat = {
			channels: 1,
			container: "raw",
			encoding: "pcm_s16le",
			sampleRateHz,
		};
		await Bun.write(path, bytes);
		return {
			id,
			kind: "voiceover",
			metadata: {
				durationMs: durationMsForRawAudio(bytes, format),
				format,
				model,
				text,
				voice: input.voice,
			},
			path,
		};
	},
});

// A single text rewrite applied before TTS. `match` is matched case-insensitively
// on word boundaries; `replacement` is what the model actually reads aloud.
export type PronunciationRule = {
	match: string;
	replacement: string;
};

// Demo vocabulary that otherwise reads as one synthetic word or wrong acronym.
// Ported from Dealroom's pronunciation dictionary defaults. Provider-agnostic:
// the rewrite happens before any TTS backend, so it improves Aura and OpenAI
// output too, not just ElevenLabs.
export const DEFAULT_PRONUNCIATION_RULES: PronunciationRule[] = [
	{ match: "onSpark", replacement: "on spark" },
	{ match: "AbsoluteJS", replacement: "absolute jay ess" },
	{ match: "ElevenLabs", replacement: "eleven labs" },
	{ match: "Elysia", replacement: "el-EE-zee-uh" },
	{ match: "Deepgram", replacement: "deep gram" },
	{ match: "OpenAI", replacement: "open A I" },
	{ match: "People Data Labs", replacement: "people data labs" },
	{ match: "PDL", replacement: "pee dee ell" },
	{ match: "B2B SaaS", replacement: "bee to bee sass" },
	{ match: "CRM", replacement: "C R M" },
	{ match: "API", replacement: "A P I" },
	{ match: "Click, Click, WOW", replacement: "click click wow" },
];

export const applyPronunciationAliases = (
	text: string,
	rules: readonly PronunciationRule[] = DEFAULT_PRONUNCIATION_RULES,
): string => {
	let next = text;
	for (const rule of rules) {
		if (!rule.replacement) continue;
		const escaped = rule.match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		next = next.replace(
			new RegExp(`\\b${escaped}\\b`, "giu"),
			rule.replacement,
		);
	}
	return next;
};

// Wrap any voiceover so narration text is rewritten through pronunciation rules
// before it reaches the underlying TTS. Compose this outside the render cache so
// the cache keys on the spoken-as text.
export const withPronunciationAliases = (
	voiceover: DemoVoiceover,
	rules: readonly PronunciationRule[] = DEFAULT_PRONUNCIATION_RULES,
): DemoVoiceover => ({
	speak: (input: DemoNarrationInput) =>
		voiceover.speak({
			...input,
			text: applyPronunciationAliases(input.text, rules),
		}),
});

export type RenderCacheOptions = {
	cacheDir: string;
	// Bump whenever voice/model/settings change so stale audio is never
	// replayed. Folded into the default cache key.
	salt?: string;
	// Return null to bypass the cache for a given line (e.g. always re-render
	// dynamic narration).
	keyFor?: (input: DemoNarrationInput) => string | null;
};


// Wrap any voiceover so identical narration lines are synthesized once and
// replayed from disk on later runs — faster iteration and fewer provider
// credits. The cached audio is copied into `cacheDir` so the cache is
// self-contained even if the original output dir is cleaned between runs.
export const withRenderCache = (
	voiceover: DemoVoiceover,
	options: RenderCacheOptions,
): DemoVoiceover => ({
	speak: async (input: DemoNarrationInput): Promise<DemoArtifact | void> => {
		const rawKey = options.keyFor
			? options.keyFor(input)
			: `${input.voice ?? ""}|${input.emotion ?? ""}|${
					options.salt ?? ""
				}|${input.text}`;
		if (rawKey === null) return voiceover.speak(input);
		const hash = `${hashKey(rawKey)}-${input.text.length}`;
		const manifestPath = `${options.cacheDir}/${hash}.json`;
		const manifest = Bun.file(manifestPath);
		if (await manifest.exists()) {
			return (await manifest.json()) as DemoArtifact;
		}
		const artifact = await voiceover.speak(input);
		if (!artifact || !artifact.path) return artifact;
		const extension = artifact.path.split(".").pop() ?? "bin";
		const cachedAudioPath = `${options.cacheDir}/${hash}.${extension}`;
		await Bun.write(cachedAudioPath, Bun.file(artifact.path));
		const cachedArtifact: DemoArtifact = {
			...artifact,
			metadata: { ...artifact.metadata, cacheKey: hash, cached: true },
			path: cachedAudioPath,
		};
		await Bun.write(manifestPath, JSON.stringify(cachedArtifact));
		return cachedArtifact;
	},
});
