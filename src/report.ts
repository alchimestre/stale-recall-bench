// usage: bun src/report.ts <run dir>...  Each run dir must be graded with scripts/grade.sh first.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cases, type Case } from "./cases.ts";

type Exposure = { event: "exposure"; case: string; arm: string; shown: { stale: number } };
type Session = { event: "session"; case: string; arm: string; key: string; input: number; cacheRead: number; cacheWrite: number; toolCalls: number };
export type Cell = { run: string; case: string; arm: string; resolved: boolean; staleShown: number; staleCommands: number; inputTokens: number; toolCalls: number };

if (import.meta.main) {
    const runs = Bun.argv.slice(2);
    assert(runs.length, "usage: bun src/report.ts <run dir>...");
    console.log(formatReport(runs.flatMap(load)));
}

function load(runDir: string): Cell[] {
    const rows = readFileSync(resolve(runDir, "metrics.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line) as Exposure | Session);
    const sessions = rows.filter((row): row is Session => row.event === "session");
    return sessions.map(row => {
        const item = cases.find(entry => entry.id === row.case)!;
        const gradePath = resolve(runDir, `${row.key}.grade.json`);
        assert(existsSync(gradePath), `Ungraded: ${gradePath}; run scripts/grade.sh first`);
        const grade: { resolved_ids: string[] } = JSON.parse(readFileSync(gradePath, "utf8"));
        const shown = rows.find((entry): entry is Exposure => entry.event === "exposure" && entry.case === row.case && entry.arm === row.arm);
        return {
            run: runDir, case: row.case, arm: row.arm, resolved: grade.resolved_ids.includes(row.case), staleShown: shown?.shown.stale ?? 0,
            staleCommands: staleCommands(item, resolve(runDir, `${row.key}.events.jsonl`)), inputTokens: row.input + row.cacheRead + row.cacheWrite, toolCalls: row.toolCalls,
        };
    });
}

// Shell commands naming a stale note's symbol: evidence the agent followed the stale note.
function staleCommands(item: Case, eventsPath: string): number {
    const symbols = item.notes.filter(note => note.label === "stale").map(note => symbol(note.excerpt)).filter(Boolean);
    const events: { type?: string; args?: { command?: string } }[] = readFileSync(eventsPath, "utf8").split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
    return events.filter(event => event.type === "tool_execution_start" && symbols.some(name => event.args?.command?.includes(name))).length;
}

// The first identifier in the excerpt: a class/def name, or the assigned name.
function symbol(excerpt: string): string {
    const match = /^\s*(?:async\s+def|class|def)\s+([A-Za-z_]\w*)|^\s*([A-Za-z_][\w.]*)/.exec(excerpt);
    return match?.[1] ?? match?.[2] ?? "";
}

export function formatReport(cells: Cell[]): string {
    const arms = [...new Set(cells.map(cell => cell.arm))];
    const caseIds = [...new Set(cells.map(cell => cell.case))];
    const rate = (id: string, arm: string) => cells.filter(cell => cell.case === id && cell.arm === arm && cell.resolved).length;
    const runsPer = (id: string, arm: string) => cells.filter(cell => cell.case === id && cell.arm === arm).length;
    const lines = [`| Case | ${arms.join(" | ")} |`, `| --- |${" --- |".repeat(arms.length)}`];
    for (const id of caseIds) lines.push(`| ${id} | ${arms.map(arm => `${rate(id, arm)}/${runsPer(id, arm)}`).join(" | ")} |`);
    lines.push("", "| Arm | Resolved | Stale notes shown | Stale-symbol commands | Input tokens | Tool calls |", "| --- | --- | --- | --- | --- | --- |");
    for (const arm of arms) {
        const own = cells.filter(cell => cell.arm === arm);
        const total = (value: (cell: Cell) => number) => own.reduce((sum, cell) => sum + value(cell), 0);
        lines.push(`| ${arm} | ${own.filter(cell => cell.resolved).length}/${own.length} | ${total(cell => cell.staleShown)} | ${total(cell => cell.staleCommands)} | ${total(cell => cell.inputTokens)} | ${total(cell => cell.toolCalls)} |`);
    }
    lines.push("", "| Comparison | Cases differing | Wins | Sign test p |", "| --- | --- | --- | --- |");
    for (const [index, treated] of arms.entries()) {
        for (const control of arms.slice(index + 1)) {
            const diffs = caseIds.map(id => rate(id, treated) - rate(id, control)).filter(diff => diff !== 0);
            const wins = diffs.filter(diff => diff > 0).length;
            lines.push(`| ${treated} vs ${control} | ${diffs.length} | ${wins} | ${signTest(wins, diffs.length).toFixed(4)} |`);
        }
    }
    return lines.join("\n");
}

// Exact two-sided sign test; the case, not the run, is the sampling unit.
export function signTest(wins: number, trials: number): number {
    if (trials === 0) return 1;
    let coefficient = 1;
    let tail = 0;
    for (let k = 0; k <= Math.min(wins, trials - wins); k++) {
        tail += coefficient;
        coefficient = (coefficient * (trials - k)) / (k + 1);
    }
    return Math.min(1, (2 * tail) / 2 ** trials);
}
