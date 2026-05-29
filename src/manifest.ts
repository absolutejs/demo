import type { DemoRunReport } from "./types";
import { createDemoTimeline } from "./timeline";

export type DemoManifestOptions = {
	environment?: string;
	gitSha?: string;
	operator?: string;
	outputPath?: string;
	redactions?: string[];
	[key: string]: unknown;
};

export type DemoManifest = {
	format: "absolute-demo-manifest";
	version: 1;
	generatedAt: string;
	run: DemoRunReport;
	proof: {
		artifactCount: number;
		durationMs: number;
		eventCount: number;
		hasRecording: boolean;
		hasVoiceover: boolean;
		status: DemoRunReport["status"];
	};
	options?: DemoManifestOptions;
	timeline: ReturnType<typeof createDemoTimeline>;
};

export const createDemoManifest = (
	run: DemoRunReport,
	options?: DemoManifestOptions,
): DemoManifest => ({
	format: "absolute-demo-manifest",
	generatedAt: new Date().toISOString(),
	options,
	proof: {
		artifactCount: run.artifacts.length,
		durationMs: run.durationMs,
		eventCount: run.events.length,
		hasRecording: run.artifacts.some(
			(artifact) => artifact.kind === "recording",
		),
		hasVoiceover: run.artifacts.some(
			(artifact) => artifact.kind === "voiceover",
		),
		status: run.status,
	},
	run,
	timeline: createDemoTimeline(run),
	version: 1,
});

export const writeDemoManifest = async (
	run: DemoRunReport,
	path: string,
	options?: DemoManifestOptions,
): Promise<DemoManifest> => {
	const manifest = createDemoManifest(run, { ...options, outputPath: path });
	await Bun.write(path, JSON.stringify(manifest, null, 2));
	return manifest;
};
