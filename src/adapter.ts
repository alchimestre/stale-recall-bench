import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { git, labels, worktree, type Case, type Label } from "./cases.ts";
import { command } from "./command.ts";

export const recallCharLimit = 6000;
const adapterTimeoutMs = 120_000;

export type Exposure = { case: string; arm: string; shown: Record<Label, number>; total: Record<Label, number>; shownNotes: string[] };
type Step = "ingest" | "recall";

// Ingests each note at the revision it was observed, then recalls at the task's base revision.
export function recallFor(adapter: string, item: Case, prompt: string, stateRoot: string): string {
    const state = resolve(stateRoot, item.id);
    mkdirSync(state, { recursive: true });
    const revisions = [...new Set(item.notes.map(note => note.revision))];
    const checkoutDir = worktree(revisions[0]);
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

// A note counts as shown when its excerpt appears verbatim anywhere in the recall text.
export function exposure(item: Case, arm: string, recall: string): Exposure {
    const shown = { stale: 0, fresh: 0 };
    const total = { stale: 0, fresh: 0 };
    const shownNotes: string[] = [];
    for (const note of item.notes) {
        total[note.label]++;
        if (!recall.includes(note.excerpt)) continue;
        shown[note.label]++;
        shownNotes.push(`${note.label} ${note.path}: ${note.excerpt}`);
    }
    return { case: item.id, arm, shown, total, shownNotes };
}

export function formatExposure(rows: Exposure[]): string {
    const arms = [...new Set(rows.map(row => row.arm))];
    const lines = ["| Arm | Stale notes shown | Fresh notes shown |", "| --- | --- | --- |"];
    for (const arm of arms) {
        const own = rows.filter(row => row.arm === arm);
        const cells = labels.map(label => `${own.reduce((total, row) => total + row.shown[label], 0)}/${own.reduce((total, row) => total + row.total[label], 0)}`);
        lines.push(`| ${arm} | ${cells.join(" | ")} |`);
    }
    return lines.join("\n");
}

function run(adapter: string, step: Step, input: object, cwd: string, state: string, revision: string): string {
    const env = { ...process.env, STALE_RECALL_STATE: state, STALE_RECALL_REVISION: revision };
    return command([adapter, step], { cwd, env, input: JSON.stringify(input), timeout: adapterTimeoutMs });
}

