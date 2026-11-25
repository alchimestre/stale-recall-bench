#!/usr/bin/env bun
// Truthiness adapter: ingest publishes each note as an exact quote through `review-pending`; recall bootstraps the store and prints the startup index.
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type Note = { path: string; excerpt: string; revision: string };

const cli = process.env.TRUTHINESS_CLI ?? resolve(import.meta.dir, "../node_modules/truthiness/src/cli.ts");
const tokenizer = process.env.TRUTHINESS_TOKENIZER ?? resolve(dirname(cli), "../scripts/truthiness-tokenizer.sh");
const state = process.env.STALE_RECALL_STATE!;
// Truthiness keys evidence to the last commit that changed source, which skips merge commits; STALE_RECALL_REVISION may be one.
const revision = git(["log", "-1", "--format=%H", "--", ":(top)", ":(top,exclude).truthiness"]).trim();
const store = resolve(state, "canonical.jsonl");
const step = process.argv[2];
const input = JSON.parse(await Bun.stdin.text());

if (step === "ingest") {
    const pending = resolve(state, `pending-${revision}.jsonl`);
    writeFileSync(pending, "");
    truthiness(["stage", pending], (input.notes as Note[]).map(draft).join(""));
    console.error(truthiness(["review-pending", store, pending]).trim());
} else if (step === "recall") {
    if (process.env.TRUTHINESS_BOOTSTRAP !== "off") console.error(truthiness(["bootstrap", store]).trim());
    if (existsSync(store)) process.stdout.write(truthiness(["index", store, "", revision, tokenizer]));
} else {
    throw new Error(`Unknown step: ${step}`);
}

function draft(note: Note): string {
    const id = createHash("sha256").update(`${note.revision}\0${note.path}\0${note.excerpt}`).digest("hex").slice(0, 16);
    const recorded = { recorded_at: new Date().toISOString(), recorded_by: "stale-recall-bench" };
    const records = [
        { id, kind: "claim", text: `${note.path}: ${note.excerpt}`, scope: "repo", anchors: [{ path: note.path }], check: null, ...recorded },
        { id: `${id}-source`, kind: "observation", content: note.excerpt, source_ref: `${revision}:${note.path}`, captured_at: recorded.recorded_at, context: { revision, source_event_id: `${id}-source`, check_session: "stale-recall-bench" }, ...recorded },
        { id: `${id}-evidence`, kind: "evidence_for", from: `${id}-source`, to: id, rationale: "Quoted line", assessment: { outcome: "supports", scope: "repo", revision }, ...recorded },
    ];
    return records.map(record => `${JSON.stringify(record)}\n`).join("");
}

function truthiness(args: string[], stdin = ""): string {
    const result = Bun.spawnSync([cli, ...args], { stdin: Buffer.from(stdin), stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(`truthiness ${args[0]} failed: ${result.stderr.toString()}`);
    return result.stdout.toString();
}

function git(args: string[]): string {
    const result = Bun.spawnSync(["git", ...args], { stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.toString()}`);
    return result.stdout.toString();
}
