import type { DemoArtifact, DemoRecorder, DemoRunInfo } from "./types";

export type CommandRecorderOptions = {
	startCommand: (run: DemoRunInfo) => string[];
	stopCommand?: (run: DemoRunInfo, reason?: string) => string[];
	outputPath?: (run: DemoRunInfo) => string;
};

export const createCommandRecorder = (
	options: CommandRecorderOptions,
): DemoRecorder => {
	let runInfo: DemoRunInfo | undefined;
	let process: Subprocess<"ignore", "pipe", "pipe"> | undefined;
	return {
		mark: async () => {},
		start: async (run) => {
			runInfo = run;
			const [cmd, ...args] = options.startCommand(run);
			if (!cmd) throw new Error("recorder start command cannot be empty");
			process = Bun.spawn([cmd, ...args], {
				stderr: "pipe",
				stdout: "pipe",
			});
		},
		stop: async (reason) => {
			if (!runInfo) return;
			if (options.stopCommand) {
				const [cmd, ...args] = options.stopCommand(runInfo, reason);
				if (cmd) {
					const stop = Bun.spawn([cmd, ...args], {
						stderr: "pipe",
						stdout: "pipe",
					});
					await stop.exited;
				}
			} else {
				process?.kill("SIGINT");
			}
			const path = options.outputPath?.(runInfo);
			return {
				id: `${runInfo.id}-recording`,
				kind: "recording",
				...(path ? { path } : {}),
				metadata: { reason },
			} satisfies DemoArtifact;
		},
	};
};

export type ScreenRecorderOptions = {
	// Where the recording is written (mp4). String or per-run factory.
	outputPath: string | ((run: DemoRunInfo) => string);
	// X display to grab. Defaults to $DISPLAY or ":0" (WSLg).
	display?: string;
	// Grab a single X window by id (e.g. "0x1200004") instead of the root. On
	// WSLg the X root is black (rootless XWayland — app windows aren't composited
	// onto it), but a window-id grab captures that window's pixels correctly.
	// When set, videoSize is ignored (the window's own size is used).
	windowId?: string;
	// "WIDTHxHEIGHT" to grab a fixed region; omit to capture the whole root.
	videoSize?: string;
	// Crop the captured frame to this rect (e.g. to drop the browser chrome and
	// keep only the page viewport). Applied after grabbing; rounded to even dims.
	cropRect?: { x: number; y: number; width: number; height: number };
	framerate?: number;
	// PulseAudio capture. true → default source; or pass a device (e.g. a sink
	// monitor like "…​.monitor" to record playback such as a Meet/Discord call).
	// Omit/false → video only.
	audio?: boolean | { device?: string };
	ffmpegPath?: string;
};

// Full-screen (X11) recorder for driving REAL apps on a display — not just the
// Playwright browser. Captures the display via x11grab (+ optional PulseAudio)
// straight to mp4. stdio is "ignore" so ffmpeg's continuous progress output
// never fills a pipe and stalls the capture (the failure mode plain command
// recorders hit on long runs); stop() SIGINTs ffmpeg and AWAITS its clean
// finalize so the mp4 has a valid trailer before anything reads it.
export const createScreenRecorder = (
	options: ScreenRecorderOptions,
): DemoRecorder => {
	let runInfo: DemoRunInfo | undefined;
	let proc: Subprocess<"ignore", "pipe", "pipe"> | undefined;
	let resolvedPath: string | undefined;
	const ffmpeg = options.ffmpegPath ?? "ffmpeg";
	const display = options.display ?? process.env.DISPLAY ?? ":0";
	const audioDevice =
		options.audio === true
			? "default"
			: typeof options.audio === "object"
				? (options.audio.device ?? "default")
				: undefined;
	return {
		mark: async () => {},
		start: async (run) => {
			runInfo = run;
			resolvedPath =
				typeof options.outputPath === "function"
					? options.outputPath(run)
					: options.outputPath;
			const args = [
				ffmpeg,
				"-y",
				"-f",
				"x11grab",
				"-framerate",
				String(options.framerate ?? 30),
				"-draw_mouse",
				"1",
				// A window grab auto-sizes; only a root/region grab takes -video_size.
				...(options.windowId
					? ["-window_id", options.windowId]
					: options.videoSize
						? ["-video_size", options.videoSize]
						: []),
				"-i",
				display,
				...(audioDevice ? ["-f", "pulse", "-i", audioDevice] : []),
				// libx264 + yuv420p require even dimensions; a grabbed window can
				// be odd (e.g. 1908x999), so crop down to the nearest even size.
				// A cropRect (e.g. to drop the browser chrome) takes precedence.
				"-vf",
				options.cropRect
					? `crop=${Math.floor(options.cropRect.width / 2) * 2}:${Math.floor(options.cropRect.height / 2) * 2}:${options.cropRect.x}:${options.cropRect.y}`
					: "crop=trunc(iw/2)*2:trunc(ih/2)*2",
				"-c:v",
				"libx264",
				"-preset",
				"veryfast",
				"-pix_fmt",
				"yuv420p",
				...(audioDevice ? ["-c:a", "aac"] : []),
				// Fragmented mp4: the file stays playable even if ffmpeg is killed
				// without writing a final moov (a long x11grab capture sometimes
				// ignores SIGINT under Bun, so we may have to SIGKILL it below).
				"-movflags",
				"frag_keyframe+empty_moov+default_base_moof",
				resolvedPath,
			];
			proc = Bun.spawn(args, { stderr: "ignore", stdout: "ignore" });
		},
		stop: async (reason) => {
			if (!runInfo) return;
			// SIGINT == graceful stop for ffmpeg (writes the trailer). It doesn't
			// always honor it under Bun on a long capture, so bound the wait and
			// escalate to SIGKILL — the fragmented mp4 above stays valid either way.
			if (proc) {
				try {
					process.kill(proc.pid, "SIGINT");
				} catch {
					/* already gone */
				}
				const exited = await Promise.race([
					proc.exited.then(() => true),
					new Promise<boolean>((resolve) =>
						setTimeout(() => resolve(false), 6000),
					),
				]);
				if (!exited) {
					try {
						process.kill(proc.pid, "SIGKILL");
					} catch {
						/* already gone */
					}
					await Promise.race([
						proc.exited,
						new Promise((resolve) => setTimeout(resolve, 3000)),
					]);
				}
			}
			return {
				id: `${runInfo.id}-recording`,
				kind: "recording",
				...(resolvedPath ? { path: resolvedPath } : {}),
				metadata: { audio: Boolean(audioDevice), display, reason },
			} satisfies DemoArtifact;
		},
	};
};

export const createPlaywrightVideoArtifact = (
	id: string,
	path: string,
	metadata?: Record<string, unknown>,
): DemoArtifact => ({
	id,
	kind: "recording",
	path,
	metadata,
});
