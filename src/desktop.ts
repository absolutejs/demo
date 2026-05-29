import type { DemoDesktopDriver, DesktopAppTarget } from "./types";

export type CommandDesktopDriverOptions = {
	open?: (target: DesktopAppTarget | string) => string[];
	focus?: (target: DesktopAppTarget | string) => string[];
	hotkey?: (keys: string[]) => string[];
	typeText?: (text: string) => string[];
	click?: (x: number, y: number) => string[];
	waitForWindow?: (
		target: DesktopAppTarget | string,
		timeoutMs?: number,
	) => string[];
};

const runCommand = async (command: string[]) => {
	const [cmd, ...args] = command;
	if (!cmd) throw new Error("desktop command cannot be empty");
	const proc = Bun.spawn([cmd, ...args], {
		stderr: "pipe",
		stdout: "pipe",
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(
			`desktop command failed (${exitCode}): ${cmd} ${stderr}`,
		);
	}
};

const targetName = (target: DesktopAppTarget | string) =>
	typeof target === "string"
		? target
		: (target.name ??
			target.bundleId ??
			target.executable ??
			target.windowTitle ??
			"");

export const createCommandDesktopDriver = (
	options: CommandDesktopDriverOptions,
): DemoDesktopDriver => ({
	click: options.click
		? (x, y) => runCommand(options.click!(x, y))
		: undefined,
	focus: (target) => {
		if (!options.focus) {
			throw new Error(
				`desktop.focus is not configured for ${targetName(target)}`,
			);
		}
		return runCommand(options.focus(target));
	},
	hotkey: (...keys) => {
		if (!options.hotkey)
			throw new Error("desktop.hotkey is not configured");
		return runCommand(options.hotkey(keys));
	},
	open: (target) => {
		if (!options.open) {
			throw new Error(
				`desktop.open is not configured for ${targetName(target)}`,
			);
		}
		return runCommand(options.open(target));
	},
	typeText: (text) => {
		if (!options.typeText)
			throw new Error("desktop.typeText is not configured");
		return runCommand(options.typeText(text));
	},
	waitForWindow: options.waitForWindow
		? (target, timeoutMs) =>
				runCommand(options.waitForWindow!(target, timeoutMs))
		: undefined,
});

export const createMacDesktopDriver = (): DemoDesktopDriver =>
	createCommandDesktopDriver({
		focus: (target) => ["open", "-a", targetName(target)],
		hotkey: (keys) => [
			"osascript",
			"-e",
			`tell application "System Events" to keystroke "${keys[keys.length - 1] ?? ""}" using {${keys
				.slice(0, -1)
				.map((key) => `${key.toLowerCase()} down`)
				.join(", ")}}`,
		],
		open: (target) => ["open", "-a", targetName(target)],
		typeText: (text) => [
			"osascript",
			"-e",
			`tell application "System Events" to keystroke ${JSON.stringify(text)}`,
		],
	});
