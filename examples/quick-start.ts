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
