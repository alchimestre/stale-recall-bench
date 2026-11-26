#!/usr/bin/env bun
// Kage adapter: ingest captures each note as a reference packet citing its file; recall prints Kage's context for the issue text, within its own token budget.
import { mkdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

type Note = { path: string; excerpt: string; revision: string };

const cli = process.env.KAGE_CLI ?? resolve(import.meta.dir, "../node_modules/.bin/kage");
// The bench caps recall at 6,000 characters; Kage's budget is in tokens, at roughly 4 characters each with headroom for its headings.
const contextTokens = "1200";
const cwd = realpathSync(process.cwd());
// Kage keeps packets in the checkout's .agent_memory/; HOME holds its global registry, kept per case so the host's stays untouched.
const home = resolve(realpathSync(process.env.STALE_RECALL_STATE!), "kage-home");
mkdirSync(home, { recursive: true });
const env = { ...process.env, HOME: home };
const step = process.argv[2];
const input = JSON.parse(await Bun.stdin.text());

if (step === "ingest") {
    kage(["init", "--project", "."]);
    for (const note of input.notes as Note[]) kage(learnArgs(note));
} else if (step === "recall") {
    process.stdout.write(kage(["recall", input.prompt, "--project", ".", "--max-context-tokens", contextTokens]));
} else {
    throw new Error(`Unknown step: ${step}`);
}

// Kage's admission floor rejects a bare quote; evidence and a verifying command lift it to the floor without --allow-low-quality.
function learnArgs(note: Note): string[] {
    const claim = `${note.path}: ${note.excerpt}`;
    return [
        "learn", "--project", ".", "--type", "reference", "--title", claim, "--learning", claim,
        "--evidence", `Quoted line from ${note.path} at ${note.revision}`, "--verified-by", `git show ${note.revision}:${note.path}`,
        "--paths", note.path,
    ];
}

function kage(args: string[]): string {
    const result = Bun.spawnSync([cli, ...args], { cwd, env, stdin: "ignore", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(`kage ${args[0]} failed: ${result.stderr.toString()}${result.stdout.toString()}`);
    return result.stdout.toString();
}
