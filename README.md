# stale-recall-bench

A benchmark for coding-agent memory: it feeds your memory system notes that were true when written but are now stale, plus still-true controls, and measures what it shows the agent. An optional agent tier runs real SWE-bench Verified tasks with each system's recall and grades the patches.

## Disclosure

| Fact | Detail |
| --- | --- |
| Origin | Built by the author of [Truthiness](https://github.com/alchimestre/truthiness), a memory system this benchmark can score |
| Bundled memory systems | None; `adapters/flat.ts` is a reference control, not a candidate |
| Case selection | Fixed before any adapter was scored; the rules are listed below |

## Cases

Five sphinx tasks from SWE-bench Verified (`7590`, `8548`, `9229`, `9461`, `11510`), in upstream `created_at` order, pinned in `cases.json`.

| Note label | Count | Definition |
| --- | --- | --- |
| `stale` | 11 | A line removed by the last commit before the base that touched a gold-patch hunk region. Present at that commit's parent, absent from the base file and from the gold patch's added lines. Landmark lines only (`def`, `async def`, `class`, assignment from a call), up to 3 per task |
| `fresh` | 11 | A `def`/`class` line from the same file and revision, unique in the file at both revisions, nearest to the stale lines. One per stale note |

Both labels are observed at the same old revision; only the code under them moved.

```sh
bun run verify-cases
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

   | Arm | Stale notes shown | Fresh notes shown |
   | --- | --- | --- |
   | flat | 11/11 | 11/11 |
   | ideal | 0/11 | 11/11 |

3. Agent tier: one [OMP](https://github.com/can1357/oh-my-pi) session per case and arm in an offline AMD64 SWE-bench container. Arm `none` gets no recall; each adapter adds one arm. Requires Docker, `omp`, `uv`, `jq`, credentials for the model, and the images listed in `cases.json`.

   ```sh
   for image in $(jq -r '.cases[].image' cases.json); do docker pull --platform linux/amd64 "$image"; done
   bun run agent --model anthropic/claude-opus-5-5 --out runs/opus-1 adapters/flat.ts path/to/your-adapter
   ```

4. Grade with `swebench==4.1.0`.

   ```sh
   scripts/grade.sh 3 runs/opus-1
   ```

5. Report: resolution per case and arm, stale notes shown, shell commands naming a stale note's symbol, tokens, tool calls, and a two-sided sign test per arm pair. Pass several run dirs to pool replicates.

   ```sh
   bun run report runs/opus-1 runs/opus-2 runs/opus-3
   ```

## Limits

- The case is the sampling unit: with 5 cases the smallest sign-test p is 0.0625, so no single comparison reaches 0.05.
- Never pool runs from different models.
- Agent-tier sessions get one tool, a shell inside the task container, with no network and a single-commit history.
- Exposure matching is verbatim; a system that paraphrases notes scores as showing none of them.
- Stale notes for `11510` differ from the base only by `List` → `list` annotations.

## License

MIT. Issue text is fetched from the pinned [SWE-Bench-CL curriculum](https://github.com/thomasjoshi/agents-never-forget) at run time and keeps its upstream license.
