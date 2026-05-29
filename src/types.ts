export type DemoMetadata = {
	owner?: string;
	audience?: string;
	product?: string;
	environment?: string;
	tags?: string[];
	[key: string]: unknown;
};

export type DemoArtifact = {
	id: string;
	path?: string;
	url?: string;
	kind:
		| "recording"
		| "screenshot"
		| "voiceover"
		| "composition"
		| "manifest"
		| "trace"
		| "log"
		| "other";
	metadata?: Record<string, unknown>;
};

export type DemoTimelineEntry = {
	id: string;
	type:
		| "step"
		| "artifact"
		| "voiceover"
		| "recording"
		| "screenshot"
		| "composition"
		| "run";
	at: string;
	offsetMs: number;
	durationMs?: number;
	label?: string;
	artifact?: DemoArtifact;
	metadata?: Record<string, unknown>;
};

export type DemoNarrationInput = {
	text: string;
	voice?: string;
	emotion?: "neutral" | "confident" | "excited" | "calm";
	metadata?: Record<string, unknown>;
};

export type DemoVoiceover = {
	speak: (input: DemoNarrationInput) => Promise<DemoArtifact | void>;
};

export type DemoAnnotation =
	| {
			type: "circle" | "highlight" | "spotlight";
			selector?: string;
			x?: number;
			y?: number;
			width?: number;
			height?: number;
			label?: string;
			color?: string;
			durationMs?: number;
	  }
	| {
			type: "clear";
	  };

export type DemoAnnotationDriver = {
	show: (annotation: DemoAnnotation) => Promise<void>;
};

export type DemoRecorder = {
	start: (run: DemoRunInfo) => Promise<void>;
	stop: (reason?: string) => Promise<DemoArtifact | void>;
	mark?: (label: string, metadata?: Record<string, unknown>) => Promise<void>;
};

export type DemoBrowserDriver = {
	goto: (url: string) => Promise<void>;
	click: (selector: string) => Promise<void>;
	fill: (selector: string, value: string) => Promise<void>;
	// Type character-by-character with a per-key delay, like a human, instead of
	// setting the value instantly. Falls back to fill() when unimplemented.
	type?: (
		selector: string,
		value: string,
		options?: { delayMs?: number },
	) => Promise<void>;
	press: (selector: string, key: string) => Promise<void>;
	waitFor: (target: string | number) => Promise<void>;
	screenshot?: (name?: string) => Promise<DemoArtifact | void>;
	evaluate?: <T>(fn: string, arg?: unknown) => Promise<T>;
};

// A secret resolved at sign-in time. Prefer the env reference form so real
// credentials never live in the script, the manifest, or the recording — only
// the env var *name* is stored. A bare string is allowed for non-secret values
// (usernames on a sandbox) but discouraged for passwords.
export type DemoSecret = string | { env: string };

// One field to type into a login form, in order.
export type DemoFormField = {
	selector: string;
	value: DemoSecret;
	// Submit by pressing Enter in this field instead of clicking a button.
	pressEnter?: boolean;
	// Type this field character-by-character with this per-key delay (ms),
	// like a human, instead of filling it instantly. Needs a browser driver
	// that implements type(); otherwise falls back to an instant fill.
	typeDelayMs?: number;
};

// Escape hatch for multi-step logins (e.g. username → Next → password).
export type DemoFormStep =
	| { action: "goto"; url: string }
	| {
			action: "fill";
			selector: string;
			value: DemoSecret;
			pressEnter?: boolean;
	  }
	| { action: "click"; selector: string }
	| { action: "waitFor"; target: string | number };

// How we confirm a login worked: an element that appears, and/or a URL we land
// on. At least one is recommended so a silent failure is caught.
export type DemoLoginSuccess = {
	selector?: string;
	url?: string;
};

// A named set of credentials + how to apply them. Referenced from a step by id
// via signIn("<id>"). Three kinds cover your own AbsoluteJS app, any third-party
// login form, and reusing a previously-saved browser session.
export type DemoCredentialProfile =
	| {
			id: string;
			// Your AbsoluteJS app — posts to the abs/auth login route.
			kind: "absolute";
			baseUrl?: string;
			loginRoute?: string;
			email: DemoSecret;
			password: DemoSecret;
			afterLoginUrl?: string;
			metadata?: Record<string, unknown>;
	  }
	| {
			id: string;
			// Any website's login UI — real typing and clicks through the browser.
			kind: "form";
			loginUrl?: string;
			fields?: DemoFormField[];
			submitSelector?: string;
			success?: DemoLoginSuccess;
			steps?: DemoFormStep[];
			metadata?: Record<string, unknown>;
	  }
	| {
			id: string;
			// Reuse a saved session; applied when the browser context is created.
			kind: "storage-state";
			storageState: string | Record<string, unknown>;
			metadata?: Record<string, unknown>;
	  };

export type DemoAuthDriver = {
	signIn: (
		profile: DemoCredentialProfile,
		context: DemoContext,
	) => Promise<DemoArtifact | void>;
};

export type DesktopAppTarget = {
	name?: string;
	bundleId?: string;
	executable?: string;
	windowTitle?: string;
};

export type DemoDesktopDriver = {
	open: (target: DesktopAppTarget | string) => Promise<void>;
	focus: (target: DesktopAppTarget | string) => Promise<void>;
	hotkey: (...keys: string[]) => Promise<void>;
	typeText: (text: string) => Promise<void>;
	click?: (x: number, y: number) => Promise<void>;
	waitForWindow?: (
		target: DesktopAppTarget | string,
		timeoutMs?: number,
	) => Promise<void>;
};

export type DemoRunInfo = {
	id: string;
	scriptId: string;
	startedAt: Date;
	metadata?: DemoMetadata;
};

export type DemoContext = {
	run: DemoRunInfo;
	artifacts: DemoArtifact[];
	profiles: Record<string, DemoCredentialProfile>;
	auth?: DemoAuthDriver;
	browser?: DemoBrowserDriver;
	desktop?: DemoDesktopDriver;
	recorder?: DemoRecorder;
	voiceover?: DemoVoiceover;
	annotations?: DemoAnnotationDriver;
	addArtifact: (artifact: DemoArtifact | void) => void;
	narrate: (input: string | DemoNarrationInput) => Promise<void>;
	annotate: (annotation: DemoAnnotation) => Promise<void>;
	signIn: (profileId: string) => Promise<void>;
	wait: (ms: number) => Promise<void>;
};

export type DemoStep =
	| {
			id?: string;
			name?: string;
			run: (context: DemoContext) => Promise<void> | void;
	  }
	| {
			id?: string;
			name?: string;
			signIn: string;
	  }
	| {
			id?: string;
			name?: string;
			browser:
				| { action: "goto"; url: string }
				| { action: "click"; selector: string }
				| { action: "fill"; selector: string; value: string }
				| { action: "press"; selector: string; key: string }
				| { action: "waitFor"; target: string | number }
				| { action: "screenshot"; name?: string };
	  }
	| {
			id?: string;
			name?: string;
			desktop:
				| { action: "open"; target: DesktopAppTarget | string }
				| { action: "focus"; target: DesktopAppTarget | string }
				| { action: "hotkey"; keys: string[] }
				| { action: "type"; text: string }
				| { action: "click"; x: number; y: number };
	  }
	| {
			id?: string;
			name?: string;
			narrate: string | DemoNarrationInput;
	  }
	| {
			id?: string;
			name?: string;
			annotate: DemoAnnotation;
	  }
	| {
			id?: string;
			name?: string;
			waitMs: number;
	  }
	| {
			id?: string;
			name?: string;
			recordMark: {
				label: string;
				metadata?: Record<string, unknown>;
			};
	  };

export type DemoScript = {
	id: string;
	title?: string;
	profiles?: DemoCredentialProfile[];
	metadata?: DemoMetadata;
	steps: DemoStep[];
};

export type DemoRunReport = {
	id: string;
	scriptId: string;
	startedAt: string;
	endedAt: string;
	durationMs: number;
	status: "completed" | "failed";
	error?: {
		message: string;
		stack?: string;
	};
	artifacts: DemoArtifact[];
	events: DemoRunnerEvent[];
};

export type DemoRunnerEvent =
	| { type: "run.started"; at: string; run: DemoRunInfo }
	| {
			type: "step.started";
			at: string;
			index: number;
			id?: string;
			name?: string;
	  }
	| {
			type: "step.completed";
			at: string;
			index: number;
			id?: string;
			name?: string;
	  }
	| { type: "artifact"; at: string; artifact: DemoArtifact }
	| { type: "run.completed"; at: string }
	| {
			type: "run.failed";
			at: string;
			error: { message: string; stack?: string };
	  };
