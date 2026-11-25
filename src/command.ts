import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const defaultTimeoutMs = 30_000;
const maxOutputBytes = 8 * 1024 * 1024;
const stderrTailChars = 3000;

export type CommandOptions = { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeout?: number };

export function command(args: string[], options: CommandOptions = {}): string {
    const result = spawnSync(args[0], args.slice(1), { timeout: defaultTimeoutMs, ...options, encoding: "utf8", maxBuffer: maxOutputBytes });
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.error?.message ?? result.stderr?.slice(-stderrTailChars)}`);
    return result.stdout;
}
