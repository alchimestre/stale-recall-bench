#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["mem0ai==2.2.1", "fastembed==0.9.1", "qdrant-client==1.20.0"]
# ///
# mem0 adapter: ingest stores each note verbatim (infer=False, local fastembed embedder); recall prints mem0's search hits for the issue text.
import json
import os
import sys
from pathlib import Path

# This file is named mem0.py, so its own directory must leave sys.path or it shadows the package.
sys.path.remove(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("MEM0_TELEMETRY", "False")
from mem0 import Memory

USER = "stale-recall-bench"

state = Path(os.environ["STALE_RECALL_STATE"]).resolve() / "mem0"
state.mkdir(parents=True, exist_ok=True)
# infer=False never calls the LLM; the provider is set only because Memory builds one at startup.
config = {
    "embedder": {"provider": "fastembed", "config": {"model": "BAAI/bge-small-en-v1.5"}},
    "vector_store": {"provider": "qdrant", "config": {"path": str(state / "qdrant"), "collection_name": "notes", "embedding_model_dims": 384, "on_disk": True}},
    "llm": {"provider": "openai", "config": {"api_key": "unused"}},
    "history_db_path": str(state / "history.db"),
}
memory = Memory.from_config(config)
step = sys.argv[1]
payload = json.load(sys.stdin)

if step == "ingest":
    for note in payload["notes"]:
        memory.add(f"{note['path']}: {note['excerpt']}", user_id=USER, infer=False)
elif step == "recall":
    hits = memory.search(payload["prompt"], filters={"user_id": USER})["results"]
    sys.stdout.write("".join(f"- {hit['memory']}\n" for hit in hits))
else:
    raise SystemExit(f"Unknown step: {step}")
