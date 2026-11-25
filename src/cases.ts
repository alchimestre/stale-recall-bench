import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import manifest from "../cases.json";
import { command } from "./command.ts";
import type { StaleKind } from "./staleness/index.ts";

export type Label = "stale" | "fresh";
export const labels: Label[] = ["stale", "fresh"];
export type Relevance = "fix-path" | "off-path";
export const relevances: Relevance[] = ["fix-path", "off-path"];
export type Note = { label: Label; kind: StaleKind | "unchanged"; relevance: Relevance; path: string; excerpt: string; revision: string; age_days: number; age_commits: number };
export type Case = { id: string; base: string; created_at: string; image: string; prompt_sha256: string; notes: Note[] };
type CurriculumRow = { metadata: { instance_id: string }; task: { problem_statement: string }; evaluation: { patch: string } };

export const cases = manifest.cases as Case[];
export const root = resolve(import.meta.dir, "..");
const cache = resolve(root, ".cache");
const clone = resolve(cache, "repository.git");
const curriculumFile = resolve(cache, "curriculum.json");
const cloneTimeoutMs = 600_000;
const fetchTimeoutMs = 60_000;

export function sha256(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

export function git(args: string[], cwd = ensureClone()): string {
    return command(["git", "-C", cwd, ...args], { timeout: cloneTimeoutMs });
}

export function ensureClone(): string {
    if (existsSync(clone)) return clone;
    mkdirSync(cache, { recursive: true });
    command(["git", "clone", "--quiet", "--bare", "--filter=blob:none", manifest.repository, clone], { timeout: cloneTimeoutMs });
    return clone;
}

export function worktree(revision: string): string {
    const directory = mkdtempSync(resolve(tmpdir(), "stale-recall-"));
    git(["worktree", "add", "--quiet", "--detach", "--force", directory, revision]);
    return directory;
}

export function fileAt(revision: string, path: string): string | undefined {
    const entry = git(["ls-tree", revision, "--", path]);
    return /^100(644|755) blob /.test(entry) ? git(["show", `${revision}:${path}`]) : undefined;
}

// Rows come from the pinned curriculum rather than this repository, so issue text and gold patches keep their upstream license.
export async function curriculumRows(): Promise<Map<string, CurriculumRow>> {
    if (!existsSync(curriculumFile)) {
        const response = await fetch(manifest.curriculum, { signal: AbortSignal.timeout(fetchTimeoutMs) });
        assert(response.ok, `Curriculum HTTP ${response.status}`);
        mkdirSync(cache, { recursive: true });
        await Bun.write(curriculumFile, await response.text());
    }
    const raw = await Bun.file(curriculumFile).text();
    assert.equal(sha256(raw), manifest.curriculum_sha256, "Curriculum changed upstream; delete .cache/curriculum.json to refetch");
    const { sequences }: { sequences: { tasks: CurriculumRow[] }[] } = JSON.parse(raw);
    return new Map(sequences.flatMap(sequence => sequence.tasks).map(row => [row.metadata.instance_id, row]));
}

export async function prompts(): Promise<Map<string, string>> {
    const rows = await curriculumRows();
    return new Map(cases.map((item): [string, string] => {
        const prompt = rows.get(item.id)?.task.problem_statement;
        assert(prompt && sha256(prompt) === item.prompt_sha256, `Prompt mismatch for ${item.id}`);
        return [item.id, prompt];
    }));
}
