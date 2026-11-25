// OMP extension for agent sessions: injects the arm's recall once and confines tools to one shell inside the task container.
import { spawnSync } from "node:child_process";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";

export const recallMessageType = "stale-recall";
const commandTimeoutSeconds = 40;
const spawnTimeoutMs = 45_000;
const maxOutputBytes = 96_000;

export default function benchmarkHook(pi: ExtensionAPI): void {
    const container = process.env.STALE_RECALL_CONTAINER;
    if (!container || !/^stale-recall-[a-f0-9-]+$/.test(container)) throw new Error("Invalid benchmark container");
    const recall = process.env.STALE_RECALL_TEXT;
    if (recall) {
        pi.on("before_agent_start", () => ({
            message: { customType: recallMessageType, content: recall, display: false },
        }));
    }
    pi.on("tool_call", event => {
        if (event.toolName !== "benchmark_shell") return { block: true, reason: "Tool is outside the benchmark allowlist." };
    });
    pi.registerTool({
        name: "benchmark_shell",
        label: "Repository shell",
        description: "Run a shell command inside the disposable benchmark repository. No network or host files. Python is in /opt/miniconda3/envs/testbed/bin.",
        parameters: pi.zod.object({ command: pi.zod.string() }),
        async execute(_id, { command }) {
            const args = ["exec", "-w", "/testbed", container, "timeout", String(commandTimeoutSeconds), "/bin/bash", "-c", command];
            const result = spawnSync("docker", args, { env: process.env, encoding: "utf8", timeout: spawnTimeoutMs, maxBuffer: maxOutputBytes });
            return {
                content: [{ type: "text", text: [result.stdout, result.stderr, result.error?.message, `Exit: ${result.status ?? "unknown"}`].filter(Boolean).join("\n") }],
                details: {},
                isError: result.status !== 0,
            };
        },
    });
}
