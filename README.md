# @absolutejs/demo

Automated product-demo runtime for AbsoluteJS.

`@absolutejs/demo` is the orchestration layer for enterprise-grade AI demos:
drive the product, narrate with AI voiceover, record the screen, and draw
presenter-style highlights over the UI.

It is intentionally adapter-first. Playwright is excellent for web apps, but
real demos often need Discord, Google Meet, native apps, screen switching, and
OS-level focus control. This package keeps those capabilities behind stable
interfaces so each environment can provide the right driver.

## Install

```sh
bun add @absolutejs/demo
```

Install optional drivers only when needed:

```sh
bun add -d playwright
```

## Browser demo

```ts
import {
	createDemoRunner,
	goto,
	narrate,
	signIn,
	spotlight,
	writeDemoManifest,
} from "@absolutejs/demo";
import { createDemoAuthDriver } from "@absolutejs/demo/auth";
import {
	createPlaywrightDemoSession,
} from "@absolutejs/demo/playwright";

const session = await createPlaywrightDemoSession({
	headless: false,
	recordVideoDir: ".demo-video",
	screenshotDir: ".demo-shots",
});

const runner = createDemoRunner({
	auth: createDemoAuthDriver(),
	browser: session.browserDriver,
	annotations: session.annotations,
	voiceover: {
		speak: async ({ text }) => {
			console.log("[voiceover]", text);
		},
	},
});

const report = await runner.run({
	profiles: [
		{
			id: "ae",
			kind: "absolute",
			baseUrl: "http://localhost:3000",
			email: { env: "DEMO_EMAIL" },
			password: { env: "DEMO_PASSWORD" },
			afterLoginUrl: "http://localhost:3000/pipeline",
		},
	],
	id: "crm-demo",
	title: "CRM demo",
	steps: [
		signIn("ae"),
		narrate("Here is the live pipeline view."),
		goto("http://localhost:3000/pipeline"),
		spotlight({
			selector: "[data-demo='pipeline-total']",
			label: "Revenue at risk",
			durationMs: 1800,
		}),
	],
});

await writeDemoManifest(report, ".demo-artifacts/crm-demo.manifest.json");
console.log(report.status, report.artifacts);
await session.close();
```

## Authentication

Sign-in is profile-based. Declare named credential `profiles` on the script and
trigger them with `signIn("<id>")` steps. Credentials are passed as env
*references* (`{ env: "VAR_NAME" }`) — the runner resolves them at sign-in time,
so real secrets never enter the script object, the manifest, or the recording.
A missing env var throws an error naming the variable, never its value.

Three profile kinds cover the common cases:

- `absolute` — a site you own that uses `@absolutejs/auth`. Posts to the auth
  login route (`/auth/login` by default, or `routes.login`).
- `form` — **any** site, including ones you don't control. Drives the real login
  UI: navigates to `loginUrl`, fills `fields` (with secrets from env), clicks
  `submitSelector`, and confirms via a `success` selector and/or URL. A `steps`
  array handles multi-step flows (username → Next → password).
- `storage-state` — reuse a saved Playwright session; applied when the browser
  context is created.

```ts
// A third-party site you do not control:
{
	id: "saucedemo",
	kind: "form",
	loginUrl: "https://www.saucedemo.com/",
	fields: [
		{ selector: "#user-name", value: { env: "SAUCE_USERNAME" } },
		{ selector: "#password", value: { env: "SAUCE_PASSWORD" } },
	],
	submitSelector: "#login-button",
	success: { selector: ".inventory_list" },
}
```

See `examples/demo/src/sign-in.ts` for runnable own-site (`absolute`) and
third-party (`form`) examples. For bespoke auth screens, provide your own
`DemoAuthDriver`.

## Desktop control

Use `createCommandDesktopDriver` for native-app automation. On macOS,
`createMacDesktopDriver()` can open/focus apps and send basic keystrokes via
`osascript`; Linux and Windows can provide equivalent command factories using
`xdotool`, `wmctrl`, PowerShell, or a UIA bridge.

```ts
import { createDemoRunner, focusApp, openApp, wait } from "@absolutejs/demo";
import { createMacDesktopDriver } from "@absolutejs/demo/desktop";

const runner = createDemoRunner({
	desktop: createMacDesktopDriver(),
});

await runner.run({
	id: "discord-demo",
	steps: [
		openApp("Discord"),
		wait(1000),
		focusApp("Discord"),
	],
});
```

## Recording

`createCommandRecorder` wraps tools such as `ffmpeg`, OBS command bridges, or
platform-native recorders. Browser-only demos can also use Playwright video and
add the resulting path as a recording artifact.

## Voiceover

ElevenLabs is the recommended tier for client demos — Deepgram Aura is faster
and cheaper but reads more synthetic. `createElevenLabsVoiceover` defaults to an
American voice (Rachel) and the tuned runtime settings from the Dealroom voice
upgrade (`eleven_flash_v2_5`, stability `0.42`, similarity boost `0.78`, style
`0.35`, speaker boost on), rendering high-fidelity `mp3_44100_128` files.

```ts
import {
	createElevenLabsVoiceover,
	withPronunciationAliases,
	withRenderCache,
} from "@absolutejs/demo/voiceover";

// Premium voiceover, with demo-vocabulary pronunciation fixes (onSpark,
// AbsoluteJS, PDL, …) applied before TTS, and identical lines cached so
// re-runs skip re-synthesis.
const voiceover = withRenderCache(
	withPronunciationAliases(
		createElevenLabsVoiceover({
			apiKey: process.env.ELEVENLABS_API_KEY!,
			outputDir: ".demo-voiceover",
		}),
	),
	{ cacheDir: ".demo-voiceover/cache", salt: "rachel:flash_v2_5" },
);
```

`input.emotion` (`neutral` | `confident` | `excited` | `calm`) nudges the
expressive controls. The narration `voice` field overrides the voice id per
line. Both pronunciation aliasing and the render cache are provider-agnostic
wrappers — they work over the Aura and generic-adapter voiceovers too.

Set `ELEVENLABS_API_KEY` (restricted synthesis key) for rendering;
`ELEVENLABS_ADMIN_API_KEY` (write-capable) is reserved for future
pronunciation-dictionary sync and should stay out of the synthesis path. See
`.env.example`.

## Composition

`composeDemoWithFFmpeg` creates a final video artifact from the run recording
and voiceover artifacts. It uses the demo timeline to offset narration against
the recorded screen.

```ts
import { composeDemoWithFFmpeg } from "@absolutejs/demo/composition";

const finalVideo = await composeDemoWithFFmpeg(report, {
	outputPath: ".demo-artifacts/crm-demo.mp4",
});
```
