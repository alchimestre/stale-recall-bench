import type { StalenessKind } from "./index.ts";
import { landmarkKind, replacements, symbol } from "./lines.ts";

// The symbol survives but its line was rewritten in place, e.g. a new signature or `List` → `list` annotations.
export const edited: StalenessKind = {
    name: "edited",
    matches(change, line) {
        if (change.newLines.includes(line)) return false;
        const name = symbol(line);
        const kind = landmarkKind(line);
        return replacements(change, line).some(next => landmarkKind(next) === kind && symbol(next) === name);
    },
};
