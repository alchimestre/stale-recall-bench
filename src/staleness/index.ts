import { deleted } from "./deleted.ts";
import { edited } from "./edited.ts";
import { moved } from "./moved.ts";
import { renamed } from "./renamed.ts";
import { landmarkKind } from "./lines.ts";

export type StaleKind = "moved" | "renamed" | "edited" | "deleted";
// One file seen at a note's revision (old) and at the task base (new); lines are trimmed.
// Hunks pair removed with added lines from `git diff`, so a rewrite is matched to its own replacement only.
export type Hunk = { removed: string[]; added: string[] };
export type FileChange = { oldPath: string; newPath: string; oldLines: string[]; newLines: string[]; hunks: Hunk[] };
export type StalenessKind = { name: StaleKind; matches(change: FileChange, line: string): boolean };

// Order decides ties: a line goes to the first kind that matches, so `deleted` must stay last as the fallback.
export const kinds: StalenessKind[] = [moved, renamed, edited, deleted];
export const kindNames = kinds.map(kind => kind.name);

const minExcerptChars = 8;
const maxExcerptChars = 160;
const perKind = 3;

export function candidateLines(oldLines: string[]): string[] {
    const counts = new Map<string, number>();
    for (const line of oldLines) counts.set(line, (counts.get(line) ?? 0) + 1);
    return [...counts].filter(([line, count]) => count === 1 && line.length >= minExcerptChars && line.length <= maxExcerptChars && landmarkKind(line)).map(([line]) => line);
}

export function findStale(change: FileChange, candidates: string[]): { kind: StaleKind; excerpt: string }[] {
    const byKind = new Map<StaleKind, string[]>(kindNames.map(name => [name, []]));
    for (const line of candidates) {
        const kind = kinds.find(entry => entry.matches(change, line));
        if (kind) byKind.get(kind.name)!.push(line);
    }
    return [...byKind].flatMap(([kind, lines]) => rankLandmarks(lines).slice(0, perKind).map(excerpt => ({ kind, excerpt })));
}

// Unchanged landmarks nearest the stale lines: same file, same revision, still true at the base.
export function freshLines(change: FileChange, candidates: string[], staleExcerpts: string[]): string[] {
    if (change.oldPath !== change.newPath || staleExcerpts.length === 0) return [];
    const staleAt = staleExcerpts.map(excerpt => change.oldLines.indexOf(excerpt));
    const distance = (line: string) => Math.min(...staleAt.map(index => Math.abs(change.oldLines.indexOf(line) - index)));
    const unchanged = candidates.filter(line => change.newLines.filter(other => other === line).length === 1);
    return unchanged.sort((left, right) => distance(left) - distance(right) || left.localeCompare(right)).slice(0, staleExcerpts.length);
}

function rankLandmarks(lines: string[]): string[] {
    const rank = (line: string) => (landmarkKind(line) === "assign" ? 1 : 0);
    return [...lines].sort((left, right) => rank(left) - rank(right) || left.localeCompare(right));
}
