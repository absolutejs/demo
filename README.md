# @absolutejs/demo

Automated product-demo runtime for AbsoluteJS.

`@absolutejs/demo` is the orchestration layer for enterprise-grade AI demos:
drive the product, narrate with AI voiceover, record the screen, and draw
presenter-style highlights over the UI.

It is intentionally adapter-first. Playwright is excellent for web apps, but
real demos often need Discord, Google Meet, native apps, screen switching, and
OS-level focus control. This package keeps those capabilities behind stable
interfaces so each environment can provide the right driver.

## Install and make your first MP4

Requires Bun, FFmpeg on PATH, and an ElevenLabs synthesis API key.
Install Chromium as well as the Playwright package:

```sh
bun add @absolutejs/demo @absolutejs/sync
bun add -d playwright
bunx playwright install chromium
ffmpeg -version
```

The root entry point exports the sync-plan helper and loads `@absolutejs/sync`.
The other optional integrations are needed only when used. On a Linux host
missing browser system libraries, install them with `bunx playwright install --with-deps chromium`.
Install FFmpeg using your OS package manager (for example `brew install ffmpeg`
on macOS or `sudo apt-get install ffmpeg` on Debian/Ubuntu).

Set `ELEVENLABS_API_KEY` in your environment or a local `.env` file. Save the
following as `demo.ts` and run `bun demo.ts` (or `DEMO_HEADLESS=1 bun demo.ts`
on a server). The narration request uses your ElevenLabs account.

This example hosts its own local fixture, so no existing application or login
credentials are needed. It writes `.demo-artifacts/quick-start/crm-demo.mp4`
and a manifest containing the recording, narration, and final video. Re-running
overwrites that output. The same script ships at `examples/quick-start.ts`.

```ts
import { mkdir } from "node:fs/promises";
import {
	createDemoRunner,
	goto,
	narrate,
	spotlight,
	writeDemoManifest,
} from "@absolutejs/demo";
import { createPlaywrightDemoSession } from "@absolutejs/demo/playwright";
import { createElevenLabsVoiceover } from "@absolutejs/demo/voiceover";
import { composeDemoWithFFmpeg } from "@absolutejs/demo/composition";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey)
	throw new Error("Set ELEVENLABS_API_KEY in your environment or .env file.");
const outputDir = ".demo-artifacts/quick-start";
await mkdir(outputDir, { recursive: true });

// Render before recording so network latency does not leave dead air.
const text =
	"Here is the live pipeline view. Revenue at risk is forty-two thousand dollars.";
const voiceover = createElevenLabsVoiceover({ apiKey, outputDir });
const narration = await voiceover.speak({ text });

// A local fixture makes this runnable without an existing app or login.
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: () =>
		new Response(
			'<!doctype html><html lang="en"><title>CRM demo</title><body style="font:24px sans-serif;padding:80px"><h1>Pipeline</h1><p id="total">Revenue at risk: $42,000</p></body></html>',
			{ headers: { "content-type": "text/html" } },
		),
});

try {
	const session = await createPlaywrightDemoSession({
		headless: process.env.DEMO_HEADLESS === "1",
		recordVideoDir: outputDir,
		contextOptions: { viewport: { width: 1280, height: 720 } },
	});
	let closed = false;
	try {
		const runner = createDemoRunner({
			browser: session.browserDriver,
			annotations: session.annotations,
			voiceover: { speak: async () => narration },
			voiceoverPlayback: "wait-for-duration",
		});
		const report = await runner.run({
			id: "crm-demo",
			steps: [
				goto(server.url.href),
				spotlight({ selector: "#total", label: "Revenue at risk" }),
				narrate(text),
			],
		});
		// Closing finalizes the video; the session does not attach it for you.
		const recording = await session.close();
		closed = true;
		if (recording) report.artifacts.push(recording);
		if (report.status === "completed") {
			report.artifacts.push(
				await composeDemoWithFFmpeg(report, {
					outputPath: outputDir + "/crm-demo.mp4",
					voiceoverTiming: "timeline",
				}),
			);
		}
		await writeDemoManifest(report, outputDir + "/crm-demo.manifest.json");
		if (report.status !== "completed")
			throw new Error(report.error?.message ?? "Demo failed");
		console.log("Created", outputDir + "/crm-demo.mp4");
	} finally {
		if (!closed) await session.close();
	}
} finally {
	await server.stop(true);
}
```

To demo your product, replace the fixture URL and selectors, add the auth driver
and a profile below, and replace the narration text. `wait-for-duration` reserves
screen time for the audio; it does not play audio through your speakers. The
composition step adds the audio to the final video. For multiple lines, render
and cache each line before recording and return its artifact from `speak`.

Always finalize the Playwright session, attach its returned recording to the
report, compose, and then write the manifest. Command recorders attached to the
runner collect their recording artifact automatically. Composition defaults to
sequential narration; use `voiceoverTiming: "timeline"` for run-clock placement.

## Packages and helpers

The browser, desktop, recording, auth, voiceover, composition, script, timeline,
manifest, and sync-plan helpers are subpath exports of `@absolutejs/demo`.
`@absolutejs/voice` supplies voice adapter contracts; `@absolutejs/voice-tester`
and `@absolutejs/meeting` with `@absolutejs/meeting-discord` or
`@absolutejs/meeting-recall` support optional live-call scenes.
The larger [examples/demo application](https://github.com/absolutejs/examples/tree/main/demo)
contains those scene helpers; it is not required for this quick start.

## Authentication

Sign-in is profile-based. Declare named credential `profiles` on the script and
trigger them with `signIn("<id>")` steps. Credentials are passed as env
_references_ (`{ env: "VAR_NAME" }`) — the runner resolves them at sign-in time,
so credential values stay out of the script object. Environment references do
not redact the screen: login fields, account names, or errors can appear in
recordings and reports. Use demo accounts and review artifacts before sharing.
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

See [examples/demo/src/run.ts](https://github.com/absolutejs/examples/blob/main/demo/src/run.ts)
for the larger runnable form-login demo. For bespoke auth screens, provide your own
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
	steps: [openApp("Discord"), wait(1000), focusApp("Discord")],
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
	voiceoverTiming: "timeline",
});
```
