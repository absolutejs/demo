import type { AudioFormat } from "@absolutejs/voice";
import { createDemoTimeline } from "./timeline";
import type { DemoArtifact, DemoRunReport } from "./types";

export type FFmpegDemoCompositionOptions = {
	outputPath: string;
	ffmpegPath?: string;
	recordingPath?: string;
	voiceoverOffsetsMs?: Record<string, number>;
	voiceoverTiming?: "timeline" | "sequential";
	voiceoverGapMs?: number;
	// "voiceover-only" (default): final audio is just the narration mix.
	// "voiceover+recording": KEEP the recording's own captured audio (e.g. the
	//   live Discord/Zoom voices grabbed via RDPSink.monitor) and mix the
	//   narration on top — the inline-real demo needs both.
	// "none": no audio track.
	audioMode?: "voiceover-only" | "voiceover+recording" | "none";
	videoCodec?: "copy" | "libx264";
	audioCodec?: "aac" | "copy";
	extendVideo?: boolean;
	outputDurationMs?: number;
	overwrite?: boolean;
};

export type DemoComposer = {
	compose: (
		run: DemoRunReport,
		options: FFmpegDemoCompositionOptions,
	) => Promise<DemoArtifact>;
};

const recordingArtifact = (run: DemoRunReport, path?: string) => {
	if (path) return { path };
	return run.artifacts.find((artifact) => artifact.kind === "recording");
};

const voiceoverArtifacts = (run: DemoRunReport) =>
	run.artifacts.filter(
		(artifact) => artifact.kind === "voiceover" && artifact.path,
	);

const audioFormatFor = (artifact: DemoArtifact): AudioFormat | undefined => {
	const format = artifact.metadata?.format;
	if (!format || typeof format !== "object") return undefined;
	return format as AudioFormat;
};

const inputArgsForVoiceover = (artifact: DemoArtifact) => {
	const format = audioFormatFor(artifact);
	if (!format) return [];
	const channels = String(format.channels);
	const sampleRate = String(format.sampleRateHz);
	if (format.encoding === "pcm_s16le") {
		return ["-f", "s16le", "-ar", sampleRate, "-ac", channels];
	}
	if (format.encoding === "mulaw") {
		return ["-f", "mulaw", "-ar", sampleRate, "-ac", channels];
	}
	if (format.encoding === "alaw") {
		return ["-f", "alaw", "-ar", sampleRate, "-ac", channels];
	}
	return [];
};

const artifactDurationMs = (artifact: DemoArtifact) => {
	const durationMs = artifact.metadata?.durationMs;
	return typeof durationMs === "number" ? durationMs : 0;
};

const voiceoverOffsetMs = (
	run: DemoRunReport,
	artifact: DemoArtifact,
	options: FFmpegDemoCompositionOptions,
	sequentialOffsets: Map<string, number>,
) => {
	const configured = options.voiceoverOffsetsMs?.[artifact.id];
	if (configured !== undefined) return Math.max(0, configured);
	if (options.voiceoverTiming !== "timeline") {
		return sequentialOffsets.get(artifact.id) ?? 0;
	}
	const timeline = createDemoTimeline(run);
	return timeline.find((entry) => entry.id === artifact.id)?.offsetMs ?? 0;
};

const runCommand = async (command: string[]) => {
	const [cmd, ...args] = command;
	if (!cmd) throw new Error("ffmpeg command cannot be empty");
	const process = Bun.spawn([cmd, ...args], {
		stderr: "pipe",
		stdout: "pipe",
	});
	// Drain stdout/stderr concurrently with waiting for exit. ffmpeg writes a
	// lot to stderr; if we only read it after `exited`, the OS pipe buffer
	// fills, ffmpeg blocks on write, and `exited` never resolves (a hang that
	// leaves a defunct child). Reading the streams now keeps it unblocked.
	const stderrText = new Response(process.stderr).text();
	const stdoutDrained = new Response(process.stdout).text();
	const [exitCode, stderr] = await Promise.all([
		process.exited,
		stderrText,
		stdoutDrained,
	]);
	if (exitCode !== 0) {
		throw new Error(`ffmpeg failed (${exitCode}): ${stderr}`);
	}
};

const buildVoiceoverFilter = (
	run: DemoRunReport,
	voices: DemoArtifact[],
	options: FFmpegDemoCompositionOptions,
	sequentialOffsets: Map<string, number>,
) => {
	const delayed = voices.map((voice, index) => {
		const delayMs = Math.round(
			voiceoverOffsetMs(run, voice, options, sequentialOffsets),
		);
		return `[${index + 1}:a]adelay=${delayMs}:all=1[a${index}]`;
	});
	// Mix the recording's own audio (input 0) in when asked, so live-captured
	// voices survive alongside the narration. The recording is undelayed (it is
	// the timeline); only the voiceovers carry an adelay offset.
	const includeRecording = options.audioMode === "voiceover+recording";
	const labels = [
		...(includeRecording ? ["[0:a]"] : []),
		...voices.map((_, index) => `[a${index}]`),
	];
	return [
		...delayed,
		`${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0[aout]`,
	].join(";");
};

const defaultVideoCodec = (outputPath: string) =>
	outputPath.toLowerCase().endsWith(".mp4") ? "libx264" : "copy";

const videoCodecArgs = (options: FFmpegDemoCompositionOptions) => {
	const codec = options.videoCodec ?? defaultVideoCodec(options.outputPath);
	if (codec === "copy") return ["-c:v", "copy"];
	return ["-c:v", codec, "-pix_fmt", "yuv420p"];
};

const voiceoverEndMs = (
	run: DemoRunReport,
	voices: DemoArtifact[],
	options: FFmpegDemoCompositionOptions,
	sequentialOffsets: Map<string, number>,
) =>
	voices.reduce(
		(max, voice) =>
			Math.max(
				max,
				voiceoverOffsetMs(run, voice, options, sequentialOffsets) +
					artifactDurationMs(voice),
			),
		0,
	);

export const composeDemoWithFFmpeg = async (
	run: DemoRunReport,
	options: FFmpegDemoCompositionOptions,
): Promise<DemoArtifact> => {
	const recording = recordingArtifact(run, options.recordingPath);
	if (!recording?.path) {
		throw new Error("Cannot compose demo: no recording artifact or path");
	}
	const ffmpeg = options.ffmpegPath ?? "ffmpeg";
	const voices = voiceoverArtifacts(run);
	const sequentialOffsets = new Map<string, number>();
	let nextOffsetMs = 0;
	for (const voice of voices) {
		sequentialOffsets.set(voice.id, nextOffsetMs);
		nextOffsetMs +=
			artifactDurationMs(voice) + (options.voiceoverGapMs ?? 250);
	}
	const command = [
		ffmpeg,
		...((options.overwrite ?? true) ? ["-y"] : ["-n"]),
		"-i",
		recording.path,
	];
	for (const voice of voices) {
		command.push(
			"-itsoffset",
			String(
				voiceoverOffsetMs(run, voice, options, sequentialOffsets) /
					1000,
			),
			...inputArgsForVoiceover(voice),
			"-i",
			voice.path!,
		);
	}
	const shouldExtendVideo =
		options.extendVideo ??
		(options.audioMode !== "none" && voices.length > 0);
	const voiceoverEndSeconds =
		voiceoverEndMs(run, voices, options, sequentialOffsets) / 1000;
	const targetDurationSeconds = Math.max(
		1,
		options.outputDurationMs ? options.outputDurationMs / 1000 : 0,
		voiceoverEndSeconds + 0.5,
	);
	const keepRecordingAudio = options.audioMode === "voiceover+recording";
	if (
		options.audioMode === "none" ||
		(voices.length === 0 && !keepRecordingAudio)
	) {
		command.push(
			...videoCodecArgs(options),
			"-an",
			"-t",
			String(Math.ceil(targetDurationSeconds)),
			options.outputPath,
		);
	} else {
		const videoLabel = shouldExtendVideo ? "[vout]" : "0:v:0";
		const filter = [
			shouldExtendVideo
				? `[0:v]tpad=stop_mode=clone:stop_duration=${Math.ceil(
						targetDurationSeconds,
					)}[vout]`
				: undefined,
			buildVoiceoverFilter(run, voices, options, sequentialOffsets),
		]
			.filter(Boolean)
			.join(";");
		command.push(
			"-filter_complex",
			filter,
			"-map",
			videoLabel,
			"-map",
			"[aout]",
			...videoCodecArgs(options),
			"-c:a",
			options.audioCodec ?? "aac",
			"-t",
			String(Math.ceil(targetDurationSeconds)),
			options.outputPath,
		);
	}
	await runCommand(command);
	return {
		id: `${run.id}-composition`,
		kind: "composition",
		metadata: {
			audioMode: options.audioMode ?? "voiceover-only",
			durationSeconds: Math.ceil(targetDurationSeconds),
			extendVideo: shouldExtendVideo,
			ffmpeg,
			voiceoverCount: voices.length,
		},
		path: options.outputPath,
	};
};

export const createFFmpegDemoComposer = (): DemoComposer => ({
	compose: composeDemoWithFFmpeg,
});
