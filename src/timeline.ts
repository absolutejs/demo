import type {
	DemoArtifact,
	DemoRunReport,
	DemoRunnerEvent,
	DemoTimelineEntry,
} from "./types";

export type CreateDemoTimelineOptions = {
	includeSteps?: boolean;
};

const eventOffsetMs = (run: DemoRunReport, event: DemoRunnerEvent) =>
	new Date(event.at).getTime() - new Date(run.startedAt).getTime();

const artifactType = (artifact: DemoArtifact): DemoTimelineEntry["type"] => {
	if (artifact.kind === "voiceover") return "voiceover";
	if (artifact.kind === "recording") return "recording";
	if (artifact.kind === "screenshot") return "screenshot";
	if (artifact.kind === "composition") return "composition";
	return "artifact";
};

export const createDemoTimeline = (
	run: DemoRunReport,
	options: CreateDemoTimelineOptions = {},
): DemoTimelineEntry[] =>
	run.events.flatMap((event): DemoTimelineEntry[] => {
		const offsetMs = Math.max(0, eventOffsetMs(run, event));
		if (event.type === "run.started" || event.type === "run.completed") {
			return [
				{
					at: event.at,
					id: event.type,
					label: event.type,
					offsetMs,
					type: "run",
				},
			];
		}
		if (event.type === "artifact") {
			return [
				{
					artifact: event.artifact,
					at: event.at,
					id: event.artifact.id,
					label: event.artifact.id,
					metadata: event.artifact.metadata,
					offsetMs,
					type: artifactType(event.artifact),
				},
			];
		}
		if (
			options.includeSteps &&
			(event.type === "step.started" || event.type === "step.completed")
		) {
			return [
				{
					at: event.at,
					id: `${event.type}-${event.index}`,
					label: event.name ?? event.id ?? String(event.index),
					offsetMs,
					type: "step",
				},
			];
		}
		if (event.type === "run.failed") {
			return [
				{
					at: event.at,
					id: "run.failed",
					label: event.error.message,
					offsetMs,
					type: "run",
				},
			];
		}
		return [];
	});

export const getDemoArtifactOffsetMs = (
	run: DemoRunReport,
	artifactId: string,
): number | undefined =>
	createDemoTimeline(run).find((entry) => entry.id === artifactId)?.offsetMs;
