// usage: bun src/exposure.ts [selection flags] <adapter>...  Prints how many stale and fresh notes each adapter shows at recall.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { exposure, formatExposure, recallFor, type Exposure } from "./adapter.ts";
import { cases, prompts } from "./cases.ts";
import { parseSelection, selectionOptions, selectNotes } from "./select.ts";

const { values, positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true, options: selectionOptions });
assert(positionals.length, "usage: bun src/exposure.ts [selection flags] <adapter>...");
const selection = parseSelection(values);
const adapters = positionals.map(path => resolve(path));
const texts = await prompts();
const rows: Exposure[] = [];
for (const adapter of adapters) {
    const state = mkdtempSync(resolve(tmpdir(), "stale-recall-state-"));
    try {
        for (const item of cases.map(entry => selectNotes(entry, selection))) {
            const row = exposure(item, basename(adapter, extname(adapter)), recallFor(adapter, item, texts.get(item.id)!, state));
            rows.push(row);
            console.error(JSON.stringify(row));
        }
    } finally {
        rmSync(state, { recursive: true, force: true });
    }
}
console.log(formatExposure(rows));
