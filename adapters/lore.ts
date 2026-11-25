#!/usr/bin/env bun
// LORE adapter: ingest writes each note as one project-memory fact; recall prints the session-start snapshot.
import { mkdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

type Note = { path: string; excerpt: string; revision: string };

const cli = process.env.LORE_CLI ?? "lore";
// LORE refuses paths that cross a symlink, and the bench's temp dirs sit under macOS's /var -> /private/var.
const cwd = realpathSync(process.cwd());
const root = resolve(realpathSync(process.env.STALE_RECALL_STATE!), "lore");
mkdirSync(root, { recursive: true });
// A non-default LORE_ROOT keeps the host's store and settings out; the write gate would stage scripted writes for review.
const env = { ...process.env, LORE_ROOT: root, LORE_WRITE_GATE: "off", LORE_MOTD: "0" };
const step = process.argv[2];
const input = JSON.parse(await Bun.stdin.text());

if (step === "ingest") {
    for (const note of input.notes as Note[]) {
        const verdict = JSON.parse(lore(["memory", "add", "--scope", "project", `${note.path}: ${note.excerpt}`]));
        if (verdict.status !== "applied") console.error(`${note.path}: ${note.excerpt} -> ${JSON.stringify(verdict)}`);
    }
} else if (step === "recall") {
    process.stdout.write(lore(["inject"]));
} else {
    throw new Error(`Unknown step: ${step}`);
}

function lore(args: string[]): string {
    const result = Bun.spawnSync([cli, ...args], { cwd, env, stdin: "ignore", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed: ${result.stderr.toString()}${result.stdout.toString()}`);
    return result.stdout.toString();
}
