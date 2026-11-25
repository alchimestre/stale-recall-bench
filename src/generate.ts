// usage: bun src/generate.ts  Rebuilds the note pool in cases.json from upstream history and each task's gold patch.
// The gold patch only chooses which files are on the fix path; it never reaches an adapter or an agent.
import { resolve } from "node:path";
import manifest from "../cases.json";
import { cases, curriculumRows, fileAt, git, root, type Case, type Note, type Relevance } from "./cases.ts";
import { candidateLines, findStale, freshLines, type Hunk } from "./staleness/index.ts";

type SourceFile = { path: string; relevance: Relevance };
type Revision = { revision: string; oldPath: string; ageDays: number; ageCommits: number };

const ageTargetsDays = [30, 180, 365, 1095];
const offPathFileCount = 2;
const offPathWindowDays = 365;
const daySeconds = 86_400;

const rows = await curriculumRows();
const generated = cases.map(item => ({ ...item, notes: notesFor(item, rows.get(item.id)!.evaluation.patch) }));
await Bun.write(resolve(root, "cases.json"), `${JSON.stringify({ ...manifest, cases: generated }, null, 2)}\n`);
for (const item of generated) {
    const count = (label: string) => item.notes.filter(note => note.label === label).length;
    console.log(`${item.id}: ${count("stale")} stale, ${count("fresh")} fresh`);
}

function notesFor(item: Case, gold: string): Note[] {
    const fixFiles = [...gold.matchAll(/^diff --git a\/(\S+\.py) /gm)].map(match => match[1]);
    const goldAdded = new Set(gold.split("\n").filter(line => line.startsWith("+") && !line.startsWith("+++")).map(line => line.slice(1).trim()));
    const baseTime = Number(git(["show", "-s", "--format=%ct", item.base]).trim());
    const files: SourceFile[] = [
        ...fixFiles.map(path => ({ path, relevance: "fix-path" as const })),
        ...offPathFiles(item.base, baseTime, fixFiles).map(path => ({ path, relevance: "off-path" as const })),
    ];
    const notes = files.flatMap(file => revisionsOf(item.base, baseTime, file.path).flatMap(revision => notesAt(item.base, file, revision, goldAdded)));
    return distinctExcerpts(notes);
}

// The non-test source files changed most often in the year before the base, outside the fix.
function offPathFiles(base: string, baseTime: number, fixFiles: string[]): string[] {
    const since = String(baseTime - offPathWindowDays * daySeconds);
    const touched = git(["log", `--since=${since}`, "--name-only", "--format=", base, "--", "*.py"]).split("\n").filter(Boolean);
    const counts = new Map<string, number>();
    for (const path of touched) {
        if (!fixFiles.includes(path) && !/(^|\/)tests?\//.test(path)) counts.set(path, (counts.get(path) ?? 0) + 1);
    }
    const ranked = [...counts].sort(([leftPath, left], [rightPath, right]) => right - left || leftPath.localeCompare(rightPath));
    return ranked.map(([path]) => path).filter(path => fileAt(base, path) !== undefined).slice(0, offPathFileCount);
}

// For each target age, the newest commit at least that old that touched the file, following renames.
function revisionsOf(base: string, baseTime: number, path: string): Revision[] {
    const log = git(["log", "--follow", "--name-only", "--format=@%H %ct", base, "--", path]);
    const history = log.split("@").filter(Boolean).map(entry => {
        const [header, ...paths] = entry.trim().split("\n").filter(Boolean);
        const [revision, time] = header.split(" ");
        return { revision, time: Number(time), oldPath: paths[0] ?? path };
    });
    const chosen = new Map<string, Revision>();
    for (const target of ageTargetsDays) {
        const entry = history.find(commit => commit.time <= baseTime - target * daySeconds);
        if (!entry || chosen.has(entry.revision)) continue;
        const ageCommits = Number(git(["rev-list", "--count", `${entry.revision}..${base}`]).trim());
        chosen.set(entry.revision, { revision: entry.revision, oldPath: entry.oldPath, ageDays: Math.round((baseTime - entry.time) / daySeconds), ageCommits });
    }
    return [...chosen.values()];
}

function notesAt(base: string, file: SourceFile, revision: Revision, goldAdded: Set<string>): Note[] {
    const oldText = fileAt(revision.revision, revision.oldPath);
    const newText = fileAt(base, file.path) ?? "";
    if (oldText === undefined || oldText === newText) return [];
    const trim = (text: string) => text.split("\n").map(line => line.trim());
    const hunks = diffHunks(`${revision.revision}:${revision.oldPath}`, `${base}:${file.path}`, newText);
    const change = { oldPath: revision.oldPath, newPath: file.path, oldLines: trim(oldText), newLines: trim(newText), hunks };
    const candidates = candidateLines(change.oldLines).filter(line => !goldAdded.has(line));
    const stale = findStale(change, candidates);
    const fresh = freshLines(change, candidates, stale.map(note => note.excerpt));
    const shared = { relevance: file.relevance, path: revision.oldPath, revision: revision.revision, age_days: revision.ageDays, age_commits: revision.ageCommits };
    return [
        ...stale.map(({ kind, excerpt }): Note => ({ label: "stale", kind, excerpt, ...shared })),
        ...fresh.map((excerpt): Note => ({ label: "fresh", kind: "unchanged", excerpt, ...shared })),
    ];
}

function diffHunks(oldBlob: string, newBlob: string, newText: string): Hunk[] {
    if (!newText) return [];
    const diff = git(["diff", "--no-ext-diff", "--unified=0", oldBlob, newBlob]);
    return diff.split(/^@@[^\n]*\n/m).slice(1).map(body => {
        const lines = body.split("\n");
        const changed = (sign: string) => lines.filter(line => line.startsWith(sign)).map(line => line.slice(1).trim());
        return { removed: changed("-"), added: changed("+") };
    });
}

// Exposure matches excerpts verbatim, so no excerpt may repeat or sit inside another; the youngest copy wins.
function distinctExcerpts(notes: Note[]): Note[] {
    const byExcerpt = new Map<string, Note>();
    for (const note of [...notes].sort((left, right) => left.age_days - right.age_days)) {
        if (!byExcerpt.has(note.excerpt)) byExcerpt.set(note.excerpt, note);
    }
    const excerpts = [...byExcerpt.keys()];
    const kept = [...byExcerpt.values()].filter(note => !excerpts.some(other => other !== note.excerpt && other.includes(note.excerpt)));
    return kept.sort((left, right) => left.path.localeCompare(right.path) || left.age_days - right.age_days || left.excerpt.localeCompare(right.excerpt));
}
