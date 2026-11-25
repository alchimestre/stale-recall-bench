import type { StalenessKind } from "./index.ts";
import { replacements, symbol } from "./lines.ts";

// The line was rewritten in place with only its symbol renamed, and the old name is gone from the file's landmarks.
export const renamed: StalenessKind = {
    name: "renamed",
    matches(change, line) {
        const name = symbol(line);
        if (!name || change.newLines.includes(line) || change.newLines.some(next => symbol(next) === name)) return false;
        const at = line.indexOf(name);
        const pattern = new RegExp(`^${escape(line.slice(0, at))}([A-Za-z_][\\w.]*)${escape(line.slice(at + name.length))}$`);
        return replacements(change, line).some(next => pattern.test(next));
    },
};

function escape(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
