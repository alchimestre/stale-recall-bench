import type { StalenessKind } from "./index.ts";

// Fallback: the line is gone and no other kind explains where it went.
export const deleted: StalenessKind = {
    name: "deleted",
    matches: (change, line) => !change.newLines.includes(line),
};
