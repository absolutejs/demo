import { createReactiveHub, type ReactiveEvent } from "@absolutejs/sync";
import type { DemoArtifact } from "./types";

export type DemoSyncPlanItem =
	| {
			id: string;
			type: "voiceover";
			text: string;
			artifact: DemoArtifact;
			durationMs: number;
			startMs: number;
			endMs: number;
	  }
	| {
			id: string;
			type: "visual";
			label: string;
			durationMs: number;
			startMs: number;
			endMs: number;
			metadata?: Record<string, unknown>;
	  };

export type DemoSyncPlan = {
	id: string;
	items: DemoSyncPlanItem[];
	durationMs: number;
	addVoiceover: (input: {
		id: string;
		text: string;
		artifact: DemoArtifact;
		durationMs: number;
		startMs?: number;
	}) => DemoSyncPlanItem;
	addVisual: (input: {
		id: string;
		label: string;
		durationMs: number;
		startMs?: number;
		metadata?: Record<string, unknown>;
	}) => DemoSyncPlanItem;
	events: () => ReactiveEvent[];
};

export const createDemoSyncPlan = (id: string): DemoSyncPlan => {
	const hub = createReactiveHub();
	const items: DemoSyncPlanItem[] = [];
	const events: ReactiveEvent[] = [];
	let cursorMs = 0;
	const off = hub.subscribe([`demo:${id}:*`], (event) => {
		events.push(event);
	});
	const push = (item: DemoSyncPlanItem) => {
		items.push(item);
		cursorMs = Math.max(cursorMs, item.endMs);
		hub.publish(`demo:${id}:${item.type}`, item);
		return item;
	};
	return {
		addVisual: ({ durationMs, id: itemId, label, metadata, startMs }) =>
			push({
				durationMs,
				endMs: (startMs ?? cursorMs) + durationMs,
				id: itemId,
				label,
				...(metadata ? { metadata } : {}),
				startMs: startMs ?? cursorMs,
				type: "visual",
			}),
		addVoiceover: ({ artifact, durationMs, id: itemId, startMs, text }) =>
			push({
				artifact,
				durationMs,
				endMs: (startMs ?? cursorMs) + durationMs,
				id: itemId,
				startMs: startMs ?? cursorMs,
				text,
				type: "voiceover",
			}),
		events: () => {
			off();
			return [...events];
		},
		get id() {
			return id;
		},
		get items() {
			return [...items];
		},
		get durationMs() {
			return cursorMs;
		},
	};
};
