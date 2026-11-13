import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DESIGN_DIR } from "@gwinnguyen/fcs-core";

/** Next free `.design/decisions/NNNN-<slug>.md` path. */
export function nextDecisionFile(root: string, slug: string): string {
  const dir = path.join(root, DESIGN_DIR, "decisions");
  mkdirSync(dir, { recursive: true });
  const n = readdirSync(dir)
    .map((f) => /^(\d{4})-/.exec(f)?.[1])
    .filter(Boolean)
    .map(Number)
    .reduce((a, b) => Math.max(a, b), 0);
  const clean = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return path.join(dir, `${String(n + 1).padStart(4, "0")}-${clean}.md`);
}

/** Write a decision record; returns its path relative to root. */
export function recordDecision(root: string, slug: string, lines: string[]): string {
  const file = nextDecisionFile(root, slug);
  writeFileSync(file, `${lines.join("\n").trimEnd()}\n`);
  return path.relative(root, file).split(path.sep).join("/");
}
