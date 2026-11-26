#!/usr/bin/env bun
// Supermemory adapter: ingest adds each note as a document under a per-case container tag; recall prints hybrid-search results for the issue text.
import { createHash } from "node:crypto";

type Note = { path: string; excerpt: string; revision: string };
type Hit = { chunk?: string; memory?: string };

const baseUrl = process.env.SUPERMEMORY_URL ?? "http://127.0.0.1:6767";
const apiKey = process.env.SUPERMEMORY_API_KEY;
if (!apiKey) throw new Error("Set SUPERMEMORY_API_KEY (Supermemory local prints it on first boot)");
const recallCharLimit = 6000;
const pollMs = 1000;
const pollLimit = 300;
// One container per case state directory, so cases and reruns never share memories.
const containerTag = `srb-${createHash("sha256").update(process.env.STALE_RECALL_STATE!).digest("hex").slice(0, 16)}`;
const step = process.argv[2];
const input = JSON.parse(await Bun.stdin.text());

if (step === "ingest") {
    const added = [];
    for (const note of input.notes as Note[]) added.push(await call("/v3/documents", { content: `${note.path}: ${note.excerpt}`, containerTag }));
    for (const document of added) await waitUntilDone(document.id);
} else if (step === "recall") {
    const { results } = await call("/v4/search", { q: input.prompt, containerTag, searchMode: "hybrid" });
    let text = "";
    for (const hit of results as Hit[]) {
        const line = `- ${hit.chunk ?? hit.memory}\n`;
        if (text.length + line.length > recallCharLimit) break;
        text += line;
    }
    process.stdout.write(text);
} else {
    throw new Error(`Unknown step: ${step}`);
}

async function waitUntilDone(id: string): Promise<void> {
    for (let attempt = 0; attempt < pollLimit; attempt++) {
        const { status } = await call(`/v3/documents/${id}`);
        // Memory inference ("dreaming") runs later on a server schedule; recall sees what a user would right after ingest.
        if (status === "done") return;
        if (status === "failed") throw new Error(`Supermemory failed to process document ${id}`);
        await Bun.sleep(pollMs);
    }
    throw new Error(`Supermemory document ${id} not processed after ${pollLimit} polls`);
}

async function call(path: string, body?: object) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: body ? "POST" : "GET",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: body && JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Supermemory ${path} returned ${response.status}: ${await response.text()}`);
    return response.json();
}
