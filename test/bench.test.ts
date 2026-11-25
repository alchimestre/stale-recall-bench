import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { exposure } from "../src/adapter.ts";
import { cases, type Case } from "../src/cases.ts";
import { command } from "../src/command.ts";
import { signTest } from "../src/report.ts";
import { parseSelection, selectionOptions, selectNotes } from "../src/select.ts";
import { findStale, type FileChange } from "../src/staleness/index.ts";

const flat = resolve(import.meta.dir, "../adapters/flat.ts");
const select = (...args: string[]) => parseSelection(parseArgs({ args, options: selectionOptions }).values);

test("sign test matches exact binomial tails", () => {
    expect(signTest(5, 5)).toBeCloseTo(0.0625, 12);
    expect(signTest(0, 5)).toBeCloseTo(0.0625, 12);
    expect(signTest(2, 4)).toBe(1);
    expect(signTest(9, 10)).toBeCloseTo(22 / 1024, 12);
    expect(signTest(0, 0)).toBe(1);
});

test("each staleness kind is told apart by its own diff hunk", () => {
    const oldLines = ["class Widget(Base):", "def render(self) -> List[str]:", "def legacy(self):", "def kept(self):"];
    const newLines = ["class Gadget(Base):", "def render(self) -> list[str]:", "def kept(self):", "class Unrelated(Base):"];
    const hunks = [
        { removed: ["class Widget(Base):"], added: ["class Gadget(Base):"] },
        { removed: ["def render(self) -> List[str]:"], added: ["def render(self) -> list[str]:"] },
        { removed: ["def legacy(self):"], added: [] },
    ];
    const change: FileChange = { oldPath: "pkg/a.py", newPath: "pkg/a.py", oldLines, newLines, hunks };
    expect(findStale(change, oldLines)).toEqual([
        { kind: "renamed", excerpt: "class Widget(Base):" },
        { kind: "edited", excerpt: "def render(self) -> List[str]:" },
        { kind: "deleted", excerpt: "def legacy(self):" },
    ]);
    expect(findStale({ ...change, newPath: "pkg/b.py" }, ["def kept(self):"])).toEqual([{ kind: "moved", excerpt: "def kept(self):" }]);
});

test("a new class with the same base is not mistaken for a rename", () => {
    const change: FileChange = {
        oldPath: "a.py", newPath: "a.py", oldLines: ["class Gone(Base):"], newLines: ["class Fresh(Base):"],
        hunks: [{ removed: ["class Gone(Base):"], added: [] }, { removed: [], added: ["class Fresh(Base):"] }],
    };
    expect(findStale(change, change.oldLines)).toEqual([{ kind: "deleted", excerpt: "class Gone(Base):" }]);
});

test("selection filters by kind, relevance and age, and doses deterministically", () => {
    const item = cases.find(entry => entry.notes.some(note => note.kind === "edited" && note.relevance === "off-path"))!;
    const chosen = selectNotes(item, select("--kinds", "edited", "--relevance", "off-path", "--stale", "2", "--seed", "a"));
    const stale = chosen.notes.filter(note => note.label === "stale");
    expect(stale).toHaveLength(2);
    expect(stale.every(note => note.kind === "edited" && note.relevance === "off-path")).toBe(true);
    expect(chosen.notes.filter(note => note.label === "fresh")).toHaveLength(2);
    expect(selectNotes(item, select("--kinds", "edited", "--relevance", "off-path", "--stale", "2", "--seed", "a"))).toEqual(chosen);
    const old = selectNotes(item, select("--min-age-days", "300", "--stale", "all", "--fresh", "0"));
    expect(old.notes.length).toBeGreaterThan(0);
    expect(old.notes.every(note => note.label === "stale" && note.age_days >= 300)).toBe(true);
    expect(selectNotes(item, select("--stale", "0")).notes).toEqual([]);
    expect(() => select("--kinds", "typo")).toThrow("--kinds");
});

test("exposure counts verbatim excerpts with kind and relevance breakdowns", () => {
    const item: Case = selectNotes(cases[0], select("--stale", "4"));
    const [stale, ...otherStale] = item.notes.filter(note => note.label === "stale");
    const fresh = item.notes.filter(note => note.label === "fresh");
    const recall = [`- ${stale.path}: ${stale.excerpt}`, ...fresh.map(note => note.excerpt), ...otherStale.map(note => note.excerpt.slice(1))].join("\n");
    const row = exposure(item, "test", recall);
    expect(row.counts.stale).toEqual({ shown: 1, total: 4 });
    expect(row.counts.fresh).toEqual({ shown: fresh.length, total: fresh.length });
    expect(row.counts[`kind:${stale.kind}`].shown).toBe(1);
    expect(row.counts[`relevance:${stale.relevance}`].shown).toBe(1);
});

test("flat adapter shows every ingested note", () => {
    const state = mkdtempSync(resolve(tmpdir(), "stale-recall-test-"));
    try {
        const env = { ...process.env, STALE_RECALL_STATE: state };
        const item = selectNotes(cases[0], select());
        const notes = item.notes.map(({ path, excerpt, revision }) => ({ path, excerpt, revision }));
        command([flat, "ingest"], { env, input: JSON.stringify({ notes }) });
        const recall = command([flat, "recall"], { env, input: JSON.stringify({ task: item.id, prompt: "" }) });
        expect(exposure(item, "flat", recall).counts.stale.shown).toBe(3);
        expect(exposure(item, "flat", recall).counts.fresh.shown).toBe(3);
    } finally {
        rmSync(state, { recursive: true, force: true });
    }
});
