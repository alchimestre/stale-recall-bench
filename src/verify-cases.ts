// usage: bun src/verify-cases.ts  Rechecks every note in cases.json against the pinned upstream source.
import assert from "node:assert/strict";
import { cases, fileAt, type Note } from "./cases.ts";

const lines = (text: string | undefined) => (text ?? "").split("\n").map(line => line.trim());

for (const item of cases) {
    const excerpts = item.notes.map(note => note.excerpt);
    assert.equal(new Set(excerpts).size, excerpts.length, `${item.id} repeats an excerpt`);
    for (const note of item.notes) {
        const where = `${item.id} ${note.path}: ${note.excerpt}`;
        assert(lines(fileAt(note.revision, note.path)).includes(note.excerpt), `${where} is missing at its own revision`);
        assert.equal(countAtBase(item.base, note), note.label === "fresh" ? 1 : 0, `${where} is not ${note.label} at the base revision`);
        assert(excerpts.every(other => other === note.excerpt || !other.includes(note.excerpt)), `${where} is inside another note's excerpt`);
    }
    console.log(`${item.id}: ${item.notes.length} notes verified`);
}

// A moved note is stale because its path no longer exists; every other kind because its line is gone from that path.
function countAtBase(base: string, note: Note): number {
    const atBase = fileAt(base, note.path);
    if (note.kind === "moved") return atBase === undefined ? 0 : 1;
    return lines(atBase).filter(line => line === note.excerpt).length;
}
