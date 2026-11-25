# stale-recall-bench

A benchmark for coding-agent memory: it feeds your memory system notes that were true when written but are now stale, plus still-true controls, and measures what it shows the agent. An optional agent tier runs real SWE-bench Verified tasks with each system's recall and grades the patches.

## Disclosure

| Fact | Detail |
| --- | --- |
| Origin | Built by the author of [Truthiness](https://github.com/alchimestre/truthiness), a memory system this benchmark can score |
| Bundled memory systems | None; `adapters/flat.ts` is a reference control, not a candidate |
| Case selection | Fixed before any adapter was scored; the rules are listed below |

## Cases

Five sphinx tasks from SWE-bench Verified (`7590`, `8548`, `9229`, `9461`, `11510`), in upstream `created_at` order, pinned in `cases.json` with a pool of 235 stale and 225 fresh notes.

Each note is a landmark line (`def`, `async def`, `class`, assignment from a call) read from a file at an old revision. A `stale` note is gone from that path at the task base; a `fresh` note sits once in the same file at both revisions, nearest to the stale lines.

| Field | Values | Meaning |
| --- | --- | --- |
| `kind` | `renamed` (11), `edited` (109), `deleted` (113), `moved` (2); fresh notes are `unchanged` | How the line went stale, from the diff hunk that removed it |
| `relevance` | `fix-path` (123 stale), `off-path` (112 stale) | Fix path: a file the gold patch edits. Off path: one of the 2 most-committed other source files in the year before base |
| `age_days`, `age_commits` | 31 to 1,160 days | Age of the note's revision at the task base; revisions target 30, 180, 365 and 1,095 days |

| Kind | Rule |
| --- | --- |
| `moved` | File path changed and the line is still in the new file |
| `renamed` | A hunk replaces the line with one that differs only in its symbol, and the old name is gone |
| `edited` | A hunk replaces the line with one of the same landmark type and symbol |
| `deleted` | Fallback: the line is gone from the new file |

No excerpt overlaps the gold patch's added lines or another note's excerpt.

```sh
bun run verify-cases
```

### Select notes

`exposure` and `agent` take the same flags; the agent tier records them in `manifest.json`.

| Flag | Default | Effect |
| --- | --- | --- |
| `--kinds` | all four | Comma list of stale kinds |
| `--relevance` | `fix-path,off-path` | Comma list; applies to stale and fresh notes |
| `--min-age-days`, `--max-age-days` | `0`, `Infinity` | Age range; applies to stale and fresh notes |
| `--stale` | `3` | Stale notes per case: a number or `all` |
| `--fresh` | `match` | Fresh notes per case: a number, `all`, or `match` (same count as stale) |
| `--seed` | `0` | Picks which notes fill the dose; same flags pick the same notes |

```sh
bun run exposure --kinds edited,renamed --relevance fix-path --stale all adapters/flat.ts
```

### Add a staleness kind

1. Write `src/staleness/<kind>.ts` exporting a `StalenessKind` with `matches(change, line)`.
2. Register it in `kinds` in `src/staleness/index.ts`; the first match wins and `deleted` stays last.
3. Regenerate and recheck the pool.

   ```sh
   bun run generate && bun run verify-cases
   ```

## Adapter protocol

An adapter is one executable: `<adapter> ingest` and `<adapter> recall`.

| Item | Value |
| --- | --- |
| Working directory | Git checkout of the task repository: the notes' revision for `ingest`, the task base revision for `recall` |
| `STALE_RECALL_STATE` | Persistent directory, private to one adapter and one case |
| `STALE_RECALL_REVISION` | Commit currently checked out |
| `ingest` stdin | `{"notes": [{"path", "excerpt", "revision"}]}` |
| `recall` stdin | `{"task": "<instance id>", "prompt": "<issue text>"}` |
| `recall` stdout | Text the agent receives at session start, at most 6,000 characters |
| Exit status | Non-zero aborts the run |

A note counts as shown when its excerpt appears verbatim in the recall text.

## Run

Requirements: Bun 1.4, Git, network access for the first run (sphinx clone and the pinned curriculum).

1. Install.

   ```sh
   bun install
   ```

2. Exposure tier: no model, no Docker, about 10 seconds per adapter.

   ```sh
   bun run exposure adapters/flat.ts path/to/your-adapter
   ```

   | Arm | stale | fresh | kind:renamed | kind:edited | kind:deleted | relevance:fix-path | relevance:off-path |
   | --- | --- | --- | --- | --- | --- | --- | --- |
   | flat | 15/15 | 15/15 | 1/1 | 7/7 | 7/7 | 6/6 | 9/9 |
   | ideal | 0/15 | 15/15 | 0/1 | 0/7 | 0/7 | 0/6 | 0/9 |

3. Agent tier: one [OMP](https://github.com/can1357/oh-my-pi) session per case and arm in an offline AMD64 SWE-bench container. Arm `none` gets no recall; each adapter adds one arm. Requires Docker, `omp`, `uv`, `jq`, credentials for the model, and the images listed in `cases.json`.

   ```sh
   for image in $(jq -r '.cases[].image' cases.json); do docker pull --platform linux/amd64 "$image"; done
   bun run agent --model anthropic/claude-opus-5-5 --out runs/opus-1 adapters/flat.ts path/to/your-adapter
   ```

4. Grade with `swebench==4.1.0`.

   ```sh
   scripts/grade.sh 3 runs/opus-1
   ```

5. Report: resolution per case and arm, stale notes shown, shell commands naming a stale symbol that no longer exists in its file (6+ characters, no dunders), tokens, tool calls, and a two-sided sign test per arm pair. Pass several run dirs with the same selection to pool replicates.

   ```sh
   bun run report runs/opus-1 runs/opus-2 runs/opus-3
   ```

## Limits

- The case is the sampling unit: with 5 cases the smallest sign-test p is 0.0625, so no single comparison reaches 0.05.
- Never pool runs from different models.
- Agent-tier sessions get one tool, a shell inside the task container, with no network and a single-commit history.
- Exposure matching is verbatim; a system that paraphrases notes scores as showing none of them.
- Sphinx has almost no `moved` notes (2); `--kinds moved` leaves most cases empty.
- Kind rules are line heuristics on `git diff --unified=0` hunks; a rewrite split across hunks counts as `deleted`.
- Age buckets are targets: each revision is the newest commit to the file at or before its target date.
- Regenerating the pool invalidates earlier runs; `report` refuses runs made on a different `cases.json`.

## License

MIT. Issue text is fetched from the pinned [SWE-Bench-CL curriculum](https://github.com/thomasjoshi/agents-never-forget) at run time and keeps its upstream license.
