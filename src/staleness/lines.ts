import type { FileChange } from "./index.ts";

const definition = /^(async def |def |class )/;
const callAssignment = /^[\w.]+(\s*:\s*[^=]+)?\s*=\s*[\w.]+\(/;

// Landmark lines name something an agent would search for: a definition or a call result bound to a name.
export function landmarkKind(line: string): "def" | "class" | "assign" | undefined {
    if (line.startsWith("class ")) return "class";
    if (definition.test(line)) return "def";
    return callAssignment.test(line) ? "assign" : undefined;
}

// The first identifier in the excerpt: a class/def name, or the assigned name.
export function symbol(line: string): string {
    const match = /^\s*(?:async\s+def|class|def)\s+([A-Za-z_]\w*)|^\s*([A-Za-z_][\w.]*)/.exec(line);
    return match?.[1] ?? match?.[2] ?? "";
}

// Lines added by the same diff hunk that removed `line`.
export function replacements(change: FileChange, line: string): string[] {
    return change.hunks.filter(hunk => hunk.removed.includes(line)).flatMap(hunk => hunk.added);
}
