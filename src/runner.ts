import type {
	DemoAnnotation,
	DemoArtifact,
	DemoContext,
	DemoRunInfo,
	DemoRunReport,
	DemoRunnerEvent,
	DemoScript,
	DemoStep,
} from "./types";

export type CreateDemoRunnerOptions = Omit<
	DemoContext,
	| "run"
	| "artifacts"
	| "profiles"
	| "addArtifact"
	| "narrate"
	| "annotate"
	| "signIn"
	| "wait"
> & {
	idFactory?: () => string;
	annotationFailure?: "throw" | "continue";
	onEvent?: (event: DemoRunnerEvent) => void | Promise<void>;
	voiceoverPlayback?: "continue" | "wait-for-duration";
};

const defaultIdFactory = () =>
	`demo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const toErrorRecord = (error: unknown) => {
	if (error instanceof Error) {
		return {
			message: error.message,
			...(error.stack ? { stack: error.stack } : {}),
		};
	}
	return { message: String(error) };
};

const stepInfo = (step: DemoStep, index: number) => ({
	...(step.id ? { id: step.id } : {}),
	index,
	...(step.name ? { name: step.name } : {}),
});

export const createDemoRunner = (options: CreateDemoRunnerOptions = {}) => {
	const emit = async (event: DemoRunnerEvent) => {
		await options.onEvent?.(event);
	};

	const run = async (script: DemoScript): Promise<DemoRunReport> => {
		const startedAt = new Date();
		const runInfo: DemoRunInfo = {
			id: options.idFactory?.() ?? defaultIdFactory(),
			metadata: script.metadata,
			scriptId: script.id,
			startedAt,
		};
		const artifacts: DemoArtifact[] = [];
		const profiles = Object.fromEntries(
			(script.profiles ?? []).map((profile) => [profile.id, profile]),
		);
		const events: DemoRunnerEvent[] = [];
		const record = async (event: DemoRunnerEvent) => {
			events.push(event);
			await emit(event);
		};
		const addArtifact = (artifact: DemoArtifact | void) => {
			if (!artifact) return;
			artifacts.push(artifact);
			void record({
				artifact,
				at: new Date().toISOString(),
				type: "artifact",
			});
		};
		const waitForArtifactDuration = async (
			artifact: DemoArtifact | void,
		) => {
			if (
				options.voiceoverPlayback !== "wait-for-duration" ||
				artifact?.kind !== "voiceover"
			) {
				return;
			}
			const durationMs = artifact.metadata?.durationMs;
			if (typeof durationMs === "number" && durationMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, durationMs));
			}
		};
		const signIn = async (profileId: string) => {
			const profile = profiles[profileId];
			if (!profile) {
				throw new Error(`Unknown demo profile: ${profileId}`);
			}
			if (!options.auth) {
				throw new Error("Demo auth driver is not configured");
			}
			addArtifact(await options.auth.signIn(profile, context));
		};
		const context: DemoContext = {
			addArtifact,
			profiles,
			auth: options.auth,
			annotations: options.annotations,
			artifacts,
			browser: options.browser,
			desktop: options.desktop,
			narrate: async (input) => {
				const narration =
					typeof input === "string" ? { text: input } : input;
				const artifact = await options.voiceover?.speak(narration);
				addArtifact(artifact);
				await waitForArtifactDuration(artifact);
			},
			annotate: async (annotation: DemoAnnotation) => {
				try {
					await options.annotations?.show(annotation);
				} catch (error) {
					if (options.annotationFailure !== "continue") throw error;
					addArtifact({
						id: `annotation-failed-${Date.now()}`,
						kind: "log",
						metadata: {
							annotation,
							error:
								error instanceof Error
									? error.message
									: String(error),
						},
					});
				}
			},
			recorder: options.recorder,
			run: runInfo,
			signIn,
			voiceover: options.voiceover,
			wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		};

		await record({
			at: startedAt.toISOString(),
			run: runInfo,
			type: "run.started",
		});
		try {
			await options.recorder?.start(runInfo);
			for (const [index, step] of script.steps.entries()) {
				await record({
					at: new Date().toISOString(),
					type: "step.started",
					...stepInfo(step, index),
				});
				if ("run" in step) {
					await step.run(context);
				} else if ("signIn" in step) {
					await context.signIn(step.signIn);
				} else if ("browser" in step) {
					if (!options.browser) {
						throw new Error(
							"Demo browser driver is not configured",
						);
					}
					const browserStep = step.browser;
					if (browserStep.action === "goto") {
						await options.browser.goto(browserStep.url);
					} else if (browserStep.action === "click") {
						await options.browser.click(browserStep.selector);
					} else if (browserStep.action === "fill") {
						await options.browser.fill(
							browserStep.selector,
							browserStep.value,
						);
					} else if (browserStep.action === "press") {
						await options.browser.press(
							browserStep.selector,
							browserStep.key,
						);
					} else if (browserStep.action === "waitFor") {
						await options.browser.waitFor(browserStep.target);
					} else {
						addArtifact(
							await options.browser.screenshot?.(
								browserStep.name,
							),
						);
					}
				} else if ("desktop" in step) {
					if (!options.desktop) {
						throw new Error(
							"Demo desktop driver is not configured",
						);
					}
					const desktopStep = step.desktop;
					if (desktopStep.action === "open") {
						await options.desktop.open(desktopStep.target);
					} else if (desktopStep.action === "focus") {
						await options.desktop.focus(desktopStep.target);
					} else if (desktopStep.action === "hotkey") {
						await options.desktop.hotkey(...desktopStep.keys);
					} else if (desktopStep.action === "type") {
						await options.desktop.typeText(desktopStep.text);
					} else if (options.desktop.click) {
						await options.desktop.click(
							desktopStep.x,
							desktopStep.y,
						);
					} else {
						throw new Error("Demo desktop click is not configured");
					}
				} else if ("narrate" in step) {
					await context.narrate(step.narrate);
				} else if ("annotate" in step) {
					await context.annotate(step.annotate);
				} else if ("recordMark" in step) {
					await options.recorder?.mark?.(
						step.recordMark.label,
						step.recordMark.metadata,
					);
				} else {
					await context.wait(step.waitMs);
				}
				await record({
					at: new Date().toISOString(),
					type: "step.completed",
					...stepInfo(step, index),
				});
			}
			addArtifact(await options.recorder?.stop("completed"));
			const endedAt = new Date();
			await record({ at: endedAt.toISOString(), type: "run.completed" });
			return {
				artifacts,
				durationMs: endedAt.getTime() - startedAt.getTime(),
				endedAt: endedAt.toISOString(),
				events,
				id: runInfo.id,
				scriptId: script.id,
				startedAt: startedAt.toISOString(),
				status: "completed",
			};
		} catch (error) {
			const errorRecord = toErrorRecord(error);
			addArtifact(await options.recorder?.stop("failed"));
			const endedAt = new Date();
			await record({
				at: endedAt.toISOString(),
				error: errorRecord,
				type: "run.failed",
			});
			return {
				artifacts,
				durationMs: endedAt.getTime() - startedAt.getTime(),
				endedAt: endedAt.toISOString(),
				error: errorRecord,
				events,
				id: runInfo.id,
				scriptId: script.id,
				startedAt: startedAt.toISOString(),
				status: "failed",
			};
		}
	};

	return { run };
};
