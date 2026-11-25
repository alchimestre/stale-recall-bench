import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { git, labels, relevances, worktree, type Case } from "./cases.ts";
import { command } from "./command.ts";
import { kindNames } from "./staleness/index.ts";

export const recallCharLimit = 6000;
const adapterTimeoutMs = 120_000;
const hexRadix = 16;

type Tally = { shown: number; total: number };
// Keys: `stale`, `fresh`, then stale breakdowns `kind:<kind>` and `relevance:<relevance>`.
export type Exposure = { case: string; arm: string; counts: Record<string, Tally>; shownNotes: string[] };
type Step = "ingest" | "recall";

const breakdownKeys = [...labels, ...kindNames.map(kind => `kind:${kind}`), ...relevances.map(relevance => `relevance:${relevance}`)];

// Ingests notes oldest revision first, each at the revision it was observed, then recalls at the task's base revision.
export function recallFor(adapter: string, item: Case, prompt: string, stateRoot: string): string {
    const state = resolve(stateRoot, item.id);
    mkdirSync(state, { recursive: true });
    const oldestFirst = [...item.notes].sort((left, right) => right.age_days - left.age_days);
    const revisions = [...new Set(oldestFirst.map(note => note.revision))];
    const checkoutDir = worktree(item.base);
    try {
        for (const revision of revisions) {
            git(["checkout", "--quiet", "--detach", revision], checkoutDir);
            const notes = item.notes.filter(note => note.revision === revision).map(({ path, excerpt }) => ({ path, excerpt, revision }));
            run(adapter, "ingest", { notes }, checkoutDir, state, revision);
        }
        git(["checkout", "--quiet", "--detach", item.base], checkoutDir);
        const recall = run(adapter, "recall", { task: item.id, prompt }, checkoutDir, state, item.base);
        assert(recall.length <= recallCharLimit, `${adapter} recall for ${item.id} is ${recall.length} characters; the limit is ${recallCharLimit}`);
        return recall;
    } finally {
        git(["worktree", "remove", "--force", checkoutDir]);
    }
}

// A note counts as shown when its excerpt appears verbatim in the recall text, as is or with JSON string escapes decoded.
export function exposure(item: Case, arm: string, recall: string): Exposure {
    const counts: Record<string, Tally> = Object.fromEntries(breakdownKeys.map(key => [key, { shown: 0, total: 0 }]));
    const shownNotes: string[] = [];
    const decoded = recall.replace(/\\u([0-9a-fA-F]{4})|\\(["\\/])/g, (_, code: string | undefined, character: string) => (code ? String.fromCharCode(parseInt(code, hexRadix)) : character));
    for (const note of item.notes) {
        const shown = recall.includes(note.excerpt) || decoded.includes(note.excerpt);
        const keys = note.label === "stale" ? ["stale", `kind:${note.kind}`, `relevance:${note.relevance}`] : ["fresh"];
        for (const key of keys) {
            counts[key].total++;
            if (shown) counts[key].shown++;
        }
        if (shown) shownNotes.push(`${note.label} ${note.kind} ${note.path}: ${note.excerpt}`);
    }
    return { case: item.id, arm, counts, shownNotes };
}

// Columns with no notes in the selection are dropped.
export function formatExposure(rows: Exposure[]): string {
    const arms = [...new Set(rows.map(row => row.arm))];
    const total = (own: Exposure[], key: string, field: keyof Tally) => own.reduce((sum, row) => sum + row.counts[key][field], 0);
    const keys = breakdownKeys.filter(key => total(rows, key, "total") > 0);
    const lines = [`| Arm | ${keys.join(" | ")} |`, `| --- |${" --- |".repeat(keys.length)}`];
    for (const arm of arms) {
        const own = rows.filter(row => row.arm === arm);
        lines.push(`| ${arm} | ${keys.map(key => `${total(own, key, "shown")}/${total(own, key, "total")}`).join(" | ")} |`);
    }
    return lines.join("\n");
}

function run(adapter: string, step: Step, input: object, cwd: string, state: string, revision: string): string {
    const env = { ...process.env, STALE_RECALL_STATE: state, STALE_RECALL_REVISION: revision };
    return command([adapter, step], { cwd, env, input: JSON.stringify(input), timeout: adapterTimeoutMs });
}
