import path from "node:path";
import { fileURLToPath } from "node:url";

/** Directory containing this preset's `rules/*.yaml`. */
export const presetDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
