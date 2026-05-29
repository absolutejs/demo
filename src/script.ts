import type {
	DemoAnnotation,
	DemoNarrationInput,
	DemoScript,
	DemoStep,
	DesktopAppTarget,
} from "./types";

type DemoCalloutAnnotation = Exclude<DemoAnnotation, { type: "clear" }>;
type DemoCalloutInput = Omit<DemoCalloutAnnotation, "type">;

export const demoScript = (script: DemoScript): DemoScript => script;

export const signIn = (
	profileId: string,
	options: { id?: string; name?: string } = {},
): DemoStep => ({
	...options,
	signIn: profileId,
});

export const goto = (
	url: string,
	options: { id?: string; name?: string } = {},
): DemoStep => ({
	...options,
	browser: { action: "goto", url },
});

export const click = (
	selector: string,
	options: { id?: string; name?: string } = {},
): DemoStep => ({
	...options,
	browser: { action: "click", selector },
});

export const fill = (
	selector: string,
	value: string,
	options: { id?: string; name?: string } = {},
): DemoStep => ({
	...options,
	browser: { action: "fill", selector, value },
});

export const press = (
	selector: string,
	key: string,
	options: { id?: string; name?: string } = {},
): DemoStep => ({
	...options,
	browser: { action: "press", key, selector },
});

export const waitFor = (
	target: string | number,
	options: { id?: string; name?: string } = {},
): DemoStep => ({
	...options,
	browser: { action: "waitFor", target },
});

export const screenshot = (
	name?: string,
	options: { id?: string; name?: string } = {},
): DemoStep => ({
	...options,
	browser: { action: "screenshot", ...(name ? { name } : {}) },
});

export const openApp = (
	target: DesktopAppTarget | string,
	options: { id?: string; name?: string } = {},
): DemoStep => ({
	...options,
	desktop: { action: "open", target },
});

export const focusApp = (
	target: DesktopAppTarget | string,
	options: { id?: string; name?: string } = {},
): DemoStep => ({
	...options,
	desktop: { action: "focus", target },
});

export const hotkey = (
	keys: string[],
	options: { id?: string; name?: string } = {},
): DemoStep => ({
	...options,
	desktop: { action: "hotkey", keys },
});

export const typeText = (
	text: string,
	options: { id?: string; name?: string } = {},
): DemoStep => ({
	...options,
	desktop: { action: "type", text },
});

export const narrate = (
	input: string | DemoNarrationInput,
	options: { id?: string; name?: string } = {},
): DemoStep => ({
	...options,
	narrate: input,
});

export const annotate = (
	annotation: DemoAnnotation,
	options: { id?: string; name?: string } = {},
): DemoStep => ({
	...options,
	annotate: annotation,
});

export const circle = (
	annotation: DemoCalloutInput,
	options: { id?: string; name?: string } = {},
): DemoStep => annotate({ ...annotation, type: "circle" }, options);

export const highlight = (
	annotation: DemoCalloutInput,
	options: { id?: string; name?: string } = {},
): DemoStep => annotate({ ...annotation, type: "highlight" }, options);

export const spotlight = (
	annotation: DemoCalloutInput,
	options: { id?: string; name?: string } = {},
): DemoStep => annotate({ ...annotation, type: "spotlight" }, options);

export const clearAnnotations = (
	options: { id?: string; name?: string } = {},
): DemoStep => annotate({ type: "clear" }, options);

export const wait = (
	waitMs: number,
	options: { id?: string; name?: string } = {},
): DemoStep => ({
	...options,
	waitMs,
});

export const markRecording = (
	label: string,
	metadata?: Record<string, unknown>,
	options: { id?: string; name?: string } = {},
): DemoStep => ({
	...options,
	recordMark: { label, ...(metadata ? { metadata } : {}) },
});
