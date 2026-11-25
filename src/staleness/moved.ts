import type { StalenessKind } from "./index.ts";

// The line still exists, but the file it names was moved: the note's path is stale.
export const moved: StalenessKind = {
    name: "moved",
    matches: (change, line) => change.oldPath !== change.newPath && change.newLines.includes(line),
};
