import type { AuthClientRoutes } from "@absolutejs/auth/client";
import type {
	DemoArtifact,
	DemoAuthDriver,
	DemoContext,
	DemoCredentialProfile,
	DemoFormField,
	DemoFormStep,
	DemoSecret,
} from "./types";

export type DemoAuthDriverOptions = {
	// Default login route for `absolute` profiles (abs/auth route contract).
	routes?: AuthClientRoutes;
};

type BrowserLoginResult = {
	body: unknown;
	ok: boolean;
	status: number;
	url: string;
};

const DEFAULT_LOGIN_ROUTE = "/auth/login";

// Resolve a secret to its plaintext value at sign-in time. Env references are
// the safe path — the resolved value is used only to drive the login and is
// never written to an artifact, the manifest, or a log. A missing env var
// throws an error that names the variable, never its (absent) value.
const resolveSecret = (secret: DemoSecret, label: string): string => {
	if (typeof secret === "string") return secret;
	const value = process.env[secret.env];
	if (value === undefined || value === "") {
		throw new Error(
			`Missing credential env var '${secret.env}' for ${label}. Set it before running the demo.`,
		);
	}
	return value;
};

const absoluteLoginScript = String.raw`
async (input) => {
	const response = await fetch(input.baseUrl + input.loginRoute, {
		body: JSON.stringify({ email: input.email, password: input.password }),
		credentials: "include",
		headers: { "content-type": "application/json" },
		method: "POST"
	});
	const text = await response.text();
	let body = text;
	try {
		body = text === "" ? null : JSON.parse(text);
	} catch {}
	return {
		body,
		ok: response.ok,
		status: response.status,
		url: window.location.href
	};
}`;

const signInArtifact = (
	profile: DemoCredentialProfile,
	metadata: Record<string, unknown>,
): DemoArtifact => ({
	// Intentionally records only non-secret context: which profile ran, how,
	// where it landed, and whether it succeeded. No credentials.
	id: `${profile.id}-signin`,
	kind: "log",
	metadata: {
		kind: profile.kind,
		profileId: profile.id,
		...metadata,
	},
});

const requireBrowser = (context: DemoContext) => {
	if (!context.browser) {
		throw new Error(
			"Form sign-in requires a browser driver (createPlaywrightDemoSession).",
		);
	}
	return context.browser;
};

const fillField = async (
	context: DemoContext,
	field: DemoFormField,
	profileId: string,
) => {
	const browser = requireBrowser(context);
	const value = resolveSecret(
		field.value,
		`profile '${profileId}' field ${field.selector}`,
	);
	// Human typing when requested and supported; otherwise an instant fill.
	if (field.typeDelayMs !== undefined && browser.type) {
		await browser.type(field.selector, value, {
			delayMs: field.typeDelayMs,
		});
	} else {
		await browser.fill(field.selector, value);
	}
	if (field.pressEnter) await browser.press(field.selector, "Enter");
};

// Wait until the page URL contains `url`. The browser driver's waitFor() only
// does selectors/timeouts, so URL waits poll location.href via evaluate (when
// available) rather than mis-treating a URL as a CSS selector.
const waitForUrl = async (context: DemoContext, url: string) => {
	const browser = requireBrowser(context);
	if (browser.evaluate) {
		for (let attempt = 0; attempt < 50; attempt += 1) {
			const href = await browser.evaluate<string>(
				"() => window.location.href",
			);
			if (typeof href === "string" && href.includes(url)) return;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		return;
	}
	await browser.waitFor(400);
};

const runFormStep = async (
	context: DemoContext,
	step: DemoFormStep,
	profileId: string,
) => {
	const browser = requireBrowser(context);
	if (step.action === "goto") {
		await browser.goto(step.url);
	} else if (step.action === "fill") {
		await fillField(context, step, profileId);
	} else if (step.action === "click") {
		await browser.click(step.selector);
	} else {
		await browser.waitFor(step.target);
	}
};

const signInAbsolute = async (
	profile: Extract<DemoCredentialProfile, { kind: "absolute" }>,
	context: DemoContext,
	options: DemoAuthDriverOptions,
): Promise<DemoArtifact> => {
	const browser = context.browser;
	if (!browser?.evaluate) {
		throw new Error(
			"Absolute sign-in requires a browser driver with evaluate().",
		);
	}
	const result = await browser.evaluate<BrowserLoginResult>(
		absoluteLoginScript,
		{
			baseUrl: profile.baseUrl ?? "",
			email: resolveSecret(profile.email, `profile '${profile.id}' email`),
			loginRoute:
				profile.loginRoute ??
				options.routes?.login ??
				DEFAULT_LOGIN_ROUTE,
			password: resolveSecret(
				profile.password,
				`profile '${profile.id}' password`,
			),
		},
	);
	if (!result.ok) {
		throw new Error(
			`Absolute sign-in failed for '${profile.id}' (HTTP ${result.status}).`,
		);
	}
	// goto (not waitFor) the post-login URL: the script already navigated
	// client-side; goto deterministically lands there with the session cookie
	// and waits for load. waitFor() would treat the URL as a CSS selector.
	if (profile.afterLoginUrl) await browser.goto(profile.afterLoginUrl);
	return signInArtifact(profile, {
		status: result.status,
		success: true,
		...(profile.afterLoginUrl ? { url: profile.afterLoginUrl } : {}),
	});
};

const signInForm = async (
	profile: Extract<DemoCredentialProfile, { kind: "form" }>,
	context: DemoContext,
): Promise<DemoArtifact> => {
	const browser = requireBrowser(context);
	if (profile.loginUrl) await browser.goto(profile.loginUrl);
	if (profile.steps) {
		for (const step of profile.steps) {
			await runFormStep(context, step, profile.id);
		}
	}
	for (const field of profile.fields ?? []) {
		await fillField(context, field, profile.id);
	}
	if (profile.submitSelector) await browser.click(profile.submitSelector);
	if (profile.success?.url) await waitForUrl(context, profile.success.url);
	if (profile.success?.selector) {
		await browser.waitFor(profile.success.selector);
	}
	return signInArtifact(profile, {
		loginUrl: profile.loginUrl,
		success: true,
		...(profile.success?.url ? { url: profile.success.url } : {}),
	});
};

export const createDemoAuthDriver = (
	options: DemoAuthDriverOptions = {},
): DemoAuthDriver => ({
	signIn: async (profile, context) => {
		if (profile.kind === "storage-state") {
			return signInArtifact(profile, {
				message:
					"Storage-state profiles are applied when the browser context is created.",
			});
		}
		if (profile.kind === "absolute") {
			return signInAbsolute(profile, context, options);
		}
		return signInForm(profile, context);
	},
});
