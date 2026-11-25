// usage: bun src/agent.ts --model <provider/model> --out <run dir> [--max-seconds 600] <adapter>...
// Runs one agent session per case and arm. Arm `none` has no recall; each adapter is one more arm.
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { exposure, recallFor } from "./adapter.ts";
import { cases, prompts, root, sha256 } from "./cases.ts";
import { command } from "./command.ts";
import { session } from "./session.ts";

const defaultMaxSeconds = "600";
const harnessFiles = ["cases.json", "src/adapter.ts", "src/agent.ts", "src/cases.ts", "src/hook.ts", "src/session.ts"];

const { values, positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true, options: { model: { type: "string" }, out: { type: "string" }, "max-seconds": { type: "string", default: defaultMaxSeconds } } });
assert(values.model && values.out, "usage: bun src/agent.ts --model <provider/model> --out <run dir> [--max-seconds 600] <adapter>...");
const runDir = resolve(values.out);
assert(!existsSync(runDir), `${runDir} exists; pick a new run directory`);
const config = { model: values.model, maxSeconds: Number(values["max-seconds"]), runDir };
assert(Number.isInteger(config.maxSeconds) && config.maxSeconds > 0, "--max-seconds must be a positive integer");
const adapters = new Map(positionals.map(path => [basename(path, extname(path)), resolve(path)]));
assert(!adapters.has("none") && adapters.size === positionals.length, "Adapter names must be unique and not `none`");

mkdirSync(runDir, { recursive: true });
const harness = Object.fromEntries(harnessFiles.map(file => [file, sha256(readFileSync(resolve(root, file), "utf8"))]));
writeFileSync(resolve(runDir, "manifest.json"), JSON.stringify({ ...config, omp: command(["omp", "--version"]).trim(), arms: ["none", ...adapters.keys()], harness }, null, 2));
const texts = await prompts();
const state = mkdtempSync(resolve(tmpdir(), "stale-recall-state-"));
try {
    for (const item of cases) {
        const prompt = texts.get(item.id)!;
        const recalls = new Map([["none", ""], ...[...adapters].map(([arm, path]): [string, string] => [arm, recallFor(path, item, prompt, resolve(state, arm))])]);
        for (const [arm, recall] of recalls) record({ event: "exposure", ...exposure(item, arm, recall) });
        const results = await Promise.all([...recalls].map(([arm, recall]) => session(item, prompt, arm, recall, config)));
        for (const result of results) record({ event: "session", case: item.id, ...result });
    }
} finally {
    rmSync(state, { recursive: true, force: true });
}

function record(row: object): void {
    const line = JSON.stringify(row);
    appendFileSync(resolve(runDir, "metrics.jsonl"), `${line}\n`);
    console.log(line);
}
