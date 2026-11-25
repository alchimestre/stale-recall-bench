// usage: bun src/exposure.ts <adapter>...  Prints how many stale and fresh notes each adapter shows at recall.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, resolve } from "node:path";
import { exposure, formatExposure, recallFor, type Exposure } from "./adapter.ts";
import { cases, prompts } from "./cases.ts";

const adapters = Bun.argv.slice(2).map(path => resolve(path));
assert(adapters.length, "usage: bun src/exposure.ts <adapter>...");
const texts = await prompts();
const rows: Exposure[] = [];
for (const adapter of adapters) {
    const state = mkdtempSync(resolve(tmpdir(), "stale-recall-state-"));
    try {
        for (const item of cases) {
            const row = exposure(item, basename(adapter, extname(adapter)), recallFor(adapter, item, texts.get(item.id)!, state));
            rows.push(row);
            console.error(JSON.stringify(row));
        }
    } finally {
        rmSync(state, { recursive: true, force: true });
    }
}
console.log(formatExposure(rows));
