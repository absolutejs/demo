import type {
	DemoAnnotation,
	DemoAnnotationDriver,
	DemoArtifact,
	DemoBrowserDriver,
	DemoCredentialProfile,
} from "./types";
import { stat } from "node:fs/promises";

type AnyContext = {
	newPage: () => Promise<AnyPage>;
	close: () => Promise<void>;
};

type AnyBrowser = {
	newContext: (options?: Record<string, unknown>) => Promise<AnyContext>;
	close: () => Promise<void>;
};

type AnyPage = {
	close?: () => Promise<unknown>;
	goto: (url: string) => Promise<unknown>;
	click: (selector: string) => Promise<unknown>;
	fill: (selector: string, value: string) => Promise<unknown>;
	type: (
		selector: string,
		text: string,
		options?: { delay?: number },
	) => Promise<unknown>;
	press: (selector: string, key: string) => Promise<unknown>;
	waitForTimeout: (ms: number) => Promise<unknown>;
	waitForSelector: (selector: string) => Promise<unknown>;
	screenshot: (options?: {
		path?: string;
		fullPage?: boolean;
	}) => Promise<unknown>;
	evaluate: (
		fn: string | ((arg?: unknown) => unknown),
		arg?: unknown,
	) => Promise<unknown>;
	video?: () => {
		path: () => Promise<string>;
	} | null;
};

export type PlaywrightDemoBrowserOptions = {
	page: AnyPage;
	screenshotDir?: string;
	fullPageScreenshots?: boolean;
};

export const createPlaywrightDemoBrowser = (
	options: PlaywrightDemoBrowserOptions,
): DemoBrowserDriver => ({
	click: async (selector) => {
		await options.page.click(selector);
	},
	evaluate: async (fn, arg) =>
		options.page.evaluate(
			(input) => {
				const [source, value] = input as [string, unknown];
				const callable = (0, eval)(source);
				if (typeof callable !== "function") return callable;
				return callable(value);
			},
			[fn, arg],
		) as Promise<never>,
	fill: async (selector, value) => {
		await options.page.fill(selector, value);
	},
	type: async (selector, value, typeOptions) => {
		// Clear any existing value, then type key-by-key so it reads as human.
		await options.page.fill(selector, "");
		await options.page.type(selector, value, {
			delay: typeOptions?.delayMs ?? 60,
		});
	},
	goto: (url) => options.page.goto(url).then(() => undefined),
	press: async (selector, key) => {
		await options.page.press(selector, key);
	},
	screenshot: async (
		name = `screenshot-${Date.now()}`,
	): Promise<DemoArtifact> => {
		const path = options.screenshotDir
			? `${options.screenshotDir}/${name}.png`
			: undefined;
		await options.page.screenshot({
			...(path ? { path } : {}),
			fullPage: options.fullPageScreenshots ?? true,
		});
		return {
			id: name,
			kind: "screenshot",
			...(path ? { path } : {}),
		};
	},
	waitFor: async (target) => {
		if (typeof target === "number") {
			await options.page.waitForTimeout(target);
		} else {
			await options.page.waitForSelector(target);
		}
	},
});

const overlayScript = String.raw`
(annotation) => {
	const id = "__absolute_demo_overlay__";
	let root = document.getElementById(id);
	if (annotation.type === "clear") {
		root?.remove();
		return;
	}
	if (!root) {
		root = document.createElement("div");
		root.id = id;
		Object.assign(root.style, {
			position: "fixed",
			inset: "0",
			pointerEvents: "none",
			zIndex: "2147483647",
		});
		document.documentElement.appendChild(root);
	}
	root.replaceChildren();
	const rect = annotation.selector
		? document.querySelector(annotation.selector)?.getBoundingClientRect()
		: {
			x: annotation.x ?? 0,
			y: annotation.y ?? 0,
			width: annotation.width ?? 0,
			height: annotation.height ?? 0
		};
	if (!rect) return;
	const color = annotation.color ?? "#ff3b30";
	const pad = annotation.type === "spotlight" ? 8 : 6;
	const element = document.createElement("div");
	Object.assign(element.style, {
		position: "fixed",
		left: (rect.x - pad) + "px",
		top: (rect.y - pad) + "px",
		width: (rect.width + pad * 2) + "px",
		height: (rect.height + pad * 2) + "px",
		border: annotation.type === "highlight" ? "4px solid " + color : "5px solid " + color,
		borderRadius: annotation.type === "circle" ? "999px" : "10px",
		boxShadow: annotation.type === "spotlight"
			? "0 0 0 9999px rgba(0,0,0,.45), 0 0 24px " + color
			: "0 0 24px " + color,
		transition: "opacity 160ms ease",
	});
	root.appendChild(element);
	if (annotation.label) {
		const label = document.createElement("div");
		label.textContent = annotation.label;
		Object.assign(label.style, {
			position: "fixed",
			left: rect.x + "px",
			top: Math.max(12, rect.y - 42) + "px",
			background: color,
			color: "#fff",
			padding: "8px 10px",
			borderRadius: "8px",
			font: "600 14px/1.2 system-ui, -apple-system, Segoe UI, sans-serif",
			boxShadow: "0 8px 24px rgba(0,0,0,.22)",
		});
		root.appendChild(label);
	}
	if (annotation.durationMs) {
		setTimeout(() => root?.remove(), annotation.durationMs);
	}
}`;

export const createPlaywrightAnnotationDriver = (
	page: AnyPage,
): DemoAnnotationDriver => ({
	show: (annotation: DemoAnnotation) =>
		page.evaluate(overlayScript, annotation).then(() => undefined),
});

export type LaunchPlaywrightOptions = {
	browser?: "chromium" | "firefox" | "webkit";
	headless?: boolean;
	channel?: string;
};

export type PlaywrightDemoSessionOptions = LaunchPlaywrightOptions & {
	account?: DemoCredentialProfile;
	browserInstance?: AnyBrowser;
	contextOptions?: Record<string, unknown>;
	recordVideoDir?: string;
	screenshotDir?: string;
	fullPageScreenshots?: boolean;
};

export type PlaywrightDemoSession = {
	browser: AnyBrowser;
	context: AnyContext;
	page: AnyPage;
	browserDriver: DemoBrowserDriver;
	annotations: DemoAnnotationDriver;
	recordingArtifact: (id?: string) => Promise<DemoArtifact | void>;
	close: (recordingId?: string) => Promise<DemoArtifact | void>;
};

export const launchPlaywright = async (
	options: LaunchPlaywrightOptions = {},
) => {
	const dynamicImport = new Function(
		"specifier",
		"return import(specifier)",
	) as (specifier: string) => Promise<Record<string, unknown>>;
	const playwright = await dynamicImport("playwright");
	const browserType = playwright[options.browser ?? "chromium"] as {
		launch: (launchOptions: {
			headless?: boolean;
			channel?: string;
		}) => Promise<unknown>;
	};
	return browserType.launch({
		...(options.channel ? { channel: options.channel } : {}),
		headless: options.headless ?? false,
	}) as Promise<AnyBrowser>;
};

const waitForNonEmptyFile = async (path: string, timeoutMs = 3000) => {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		try {
			if ((await stat(path)).size > 0) return;
		} catch {
			// Playwright may create the video file after the context starts closing.
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};

export const createPlaywrightDemoSession = async (
	options: PlaywrightDemoSessionOptions = {},
): Promise<PlaywrightDemoSession> => {
	const browser =
		options.browserInstance ??
		(await launchPlaywright({
			browser: options.browser,
			channel: options.channel,
			headless: options.headless,
		}));
	const storageState =
		options.account?.kind === "storage-state"
			? options.account.storageState
			: undefined;
	const context = await browser.newContext({
		...options.contextOptions,
		...(storageState ? { storageState } : {}),
		...(options.recordVideoDir
			? { recordVideo: { dir: options.recordVideoDir } }
			: {}),
	});
	const page = await context.newPage();
	const browserDriver = createPlaywrightDemoBrowser({
		fullPageScreenshots: options.fullPageScreenshots,
		page,
		screenshotDir: options.screenshotDir,
	});
	const annotations = createPlaywrightAnnotationDriver(page);
	const recordingArtifact = async (id = "playwright-recording") => {
		const video = page.video?.();
		if (!video) return;
		const path = await video.path();
		await waitForNonEmptyFile(path);
		return {
			id,
			kind: "recording",
			path,
			metadata: {
				source: "playwright",
			},
		} satisfies DemoArtifact;
	};
	return {
		annotations,
		browser,
		browserDriver,
		close: async (recordingId) => {
			const artifactPromise = recordingArtifact(recordingId);
			await context.close();
			const artifact = await artifactPromise;
			if (!options.browserInstance) await browser.close();
			return artifact;
		},
		context,
		page,
		recordingArtifact,
	};
};
