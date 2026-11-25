import assert from "node:assert/strict";
import { relevances, sha256, type Case, type Note, type Relevance } from "./cases.ts";
import { kindNames, type StaleKind } from "./staleness/index.ts";

export type Selection = { kinds: StaleKind[]; relevance: Relevance[]; minAgeDays: number; maxAgeDays: number; stale: number; fresh: number | "match"; seed: string };
type Flags = { [name: string]: string | boolean | undefined };

const defaultStalePerCase = "12";

// Shared by every CLI that picks notes, so a run's manifest fully describes the dose it received.
export const selectionOptions = {
    kinds: { type: "string", default: kindNames.join(",") },
    relevance: { type: "string", default: relevances.join(",") },
    "min-age-days": { type: "string", default: "0" },
    "max-age-days": { type: "string", default: "Infinity" },
    stale: { type: "string", default: defaultStalePerCase },
    fresh: { type: "string", default: "match" },
    seed: { type: "string", default: "0" },
} as const;

export function parseSelection(flags: Flags): Selection {
    const list = (name: string, allowed: readonly string[]) => {
        const values = String(flags[name]).split(",").filter(Boolean);
        assert(values.length && values.every(value => allowed.includes(value)), `--${name} takes a comma list of: ${allowed.join(", ")}`);
        return values;
    };
    const count = (name: string, extra: string[] = []) => {
        const raw = String(flags[name]);
        if (raw === "all") return Number.POSITIVE_INFINITY;
        if (extra.includes(raw)) return raw;
        const value = Number(raw);
        assert(Number.isInteger(value) && value >= 0, `--${name} takes a non-negative integer, "all"${extra.length ? `, or ${extra.join(", ")}` : ""}`);
        return value;
    };
    const minAgeDays = Number(flags["min-age-days"]);
    const maxAgeDays = Number(flags["max-age-days"]);
    assert(minAgeDays >= 0 && maxAgeDays >= minAgeDays, "--min-age-days and --max-age-days must form a range starting at 0 or later");
    return {
        kinds: list("kinds", kindNames) as StaleKind[], relevance: list("relevance", relevances) as Relevance[], minAgeDays, maxAgeDays,
        stale: count("stale") as number, fresh: count("fresh", ["match"]) as number | "match", seed: String(flags.seed),
    };
}

// Seeded, so the same flags pick the same notes; fresh controls prefer the file and revision of a chosen stale note.
export function selectNotes(item: Case, selection: Selection): Case {
    const inRange = (note: Note) => selection.relevance.includes(note.relevance) && note.age_days >= selection.minAgeDays && note.age_days <= selection.maxAgeDays;
    const order = (note: Note) => sha256(`${selection.seed}\0${note.revision}\0${note.path}\0${note.excerpt}`);
    const byOrder = (left: Note, right: Note) => order(left).localeCompare(order(right));
    const stalePool = item.notes.filter(note => note.label === "stale" && inRange(note) && selection.kinds.includes(note.kind as StaleKind));
    const stale = stratified(stalePool.sort(byOrder), selection).slice(0, selection.stale);
    const sources = new Set(stale.map(note => `${note.revision}\0${note.path}`));
    const paired = (note: Note) => (sources.has(`${note.revision}\0${note.path}`) ? 0 : 1);
    const freshPool = item.notes.filter(note => note.label === "fresh" && inRange(note));
    const fresh = freshPool.sort((left, right) => paired(left) - paired(right) || byOrder(left, right)).slice(0, selection.fresh === "match" ? stale.length : selection.fresh);
    return { ...item, notes: [...stale, ...fresh] };
}

// Takes one note per kind and relevance in turn, so a small dose still covers rare kinds such as `renamed`.
function stratified(sorted: Note[], selection: Selection): Note[] {
    const strata = selection.kinds.flatMap(kind => selection.relevance.map(relevance => sorted.filter(note => note.kind === kind && note.relevance === relevance)));
    const deepest = Math.max(0, ...strata.map(stratum => stratum.length));
    return Array.from({ length: deepest }, (_, depth) => strata.flatMap(stratum => stratum.slice(depth, depth + 1))).flat();
}
