import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { exposure } from "../src/adapter.ts";
import { cases } from "../src/cases.ts";
import { command } from "../src/command.ts";
import { signTest } from "../src/report.ts";

const flat = resolve(import.meta.dir, "../adapters/flat.ts");

test("sign test matches exact binomial tails", () => {
    expect(signTest(5, 5)).toBeCloseTo(0.0625, 12);
    expect(signTest(0, 5)).toBeCloseTo(0.0625, 12);
    expect(signTest(2, 4)).toBe(1);
    expect(signTest(9, 10)).toBeCloseTo(22 / 1024, 12);
    expect(signTest(0, 0)).toBe(1);
});

test("exposure counts only verbatim excerpts, by label", () => {
    const item = cases[0];
    const stale = item.notes.find(note => note.label === "stale")!;
    const fresh = item.notes.filter(note => note.label === "fresh");
    const recall = [`- ${stale.path}: ${stale.excerpt}`, ...fresh.map(note => note.excerpt), stale.excerpt.slice(1)].join("\n");
    const row = exposure(item, "test", recall);
    expect(row.shown).toEqual({ stale: 1, fresh: fresh.length });
    expect(row.total.stale + row.total.fresh).toBe(item.notes.length);
});

test("every case has stale and fresh notes in equal numbers", () => {
    for (const item of cases) {
        const stale = item.notes.filter(note => note.label === "stale").length;
        expect(stale).toBeGreaterThan(0);
        expect(item.notes.length).toBe(stale * 2);
    }
});

test("flat adapter shows every ingested note", () => {
    const state = mkdtempSync(resolve(tmpdir(), "stale-recall-test-"));
    try {
        const env = { ...process.env, STALE_RECALL_STATE: state };
        const notes = cases[0].notes.map(({ path, excerpt, revision }) => ({ path, excerpt, revision }));
        command([flat, "ingest"], { env, input: JSON.stringify({ notes }) });
        const recall = command([flat, "recall"], { env, input: JSON.stringify({ task: cases[0].id, prompt: "" }) });
        expect(exposure(cases[0], "flat", recall).shown).toEqual({ stale: 3, fresh: 3 });
    } finally {
        rmSync(state, { recursive: true, force: true });
    }
});
