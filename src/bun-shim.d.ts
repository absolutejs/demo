type ReadableLike = ReadableStream<Uint8Array> | null;

type Subprocess<_Stdin = unknown, _Stdout = unknown, _Stderr = unknown> = {
	pid: number;
	exited: Promise<number>;
	stderr: ReadableLike;
	stdout: ReadableLike;
	kill: (signal?: string) => void;
};

type BunFile = {
	exists: () => Promise<boolean>;
	json: () => Promise<unknown>;
	text: () => Promise<string>;
	arrayBuffer: () => Promise<ArrayBuffer>;
};

declare const Bun: {
	spawn: (
		command: string[],
		options?: {
			stderr?: "pipe" | "ignore" | "inherit";
			stdout?: "pipe" | "ignore" | "inherit";
		},
	) => Subprocess<"ignore", "pipe", "pipe">;
	file: (path: string) => BunFile;
	write: (
		path: string,
		data: string | Uint8Array | BunFile,
	) => Promise<number>;
};
