import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DESIGN_DIR } from "@gwinnguyen/fcs-core";
import type { LintMessage } from "./lint.js";

export const BASELINE_FILE = `${DESIGN_DIR}/baseline.json`;

/**
 * Accepted pre-existing violations: file → violation key → count. A key is the lint rule, refined by pattern id for
 * `fcs/pattern` (`fcs/pattern(loading)`), so moving to another pattern's violation is not hidden by an old one.
 */
export interface Baseline {
  version: 1;
  files: Record<string, Record<string, number>>;
}

export function violationKey(m: Pick<LintMessage, "rule" | "message">): string | null {
  if (!m.rule) return null; // parse errors are never baselined
  const p = /^fcs\/pattern(?:-warn)?\(([^)]+)\)/.exec(m.message);
  return p ? `${m.rule}(${p[1]})` : m.rule;
}

export function readBaseline(root: string): Baseline | null {
  const file = path.join(root, BASELINE_FILE);
  if (!existsSync(file)) return null;
  const data = JSON.parse(readFileSync(file, "utf8")) as Partial<Baseline>;
  return { version: 1, files: data.files ?? {} };
}

export function writeBaseline(root: string, b: Baseline): void {
  const files = Object.fromEntries(
    Object.entries(b.files)
      .map(([f, keys]) => [f, Object.fromEntries(Object.entries(keys).filter(([, n]) => n > 0).sort(([a], [z]) => a.localeCompare(z)))] as const)
      .filter(([, keys]) => Object.keys(keys).length > 0)
      .sort(([a], [z]) => a.localeCompare(z)),
  );
  writeFileSync(path.join(root, BASELINE_FILE), `${JSON.stringify({ version: 1, files }, null, 2)}\n`);
}

export function countViolations(messages: LintMessage[]): Baseline["files"] {
  const out: Baseline["files"] = {};
  for (const m of messages) {
    const key = violationKey(m);
    if (!key) continue;
    const f = (out[m.file] ??= {});
    f[key] = (f[key] ?? 0) + 1;
  }
  return out;
}

export interface BaselineSplit {
  /** Messages over the baseline: new violations. */
  fresh: { message: LintMessage; allowed: number }[];
  /** Count of messages covered by the baseline. */
  covered: number;
  /** file → covered count, for nudging. */
  coveredByFile: Record<string, number>;
}

/**
 * Split lint messages into baselined and new. Per file and key: if the count is within the baseline, all are covered;
 * if it grew, every occurrence is reported (which one is new cannot be told), annotated with the allowance.
 */
export function applyBaseline(messages: LintMessage[], b: Baseline | null): BaselineSplit {
  const split: BaselineSplit = { fresh: [], covered: 0, coveredByFile: {} };
  if (!b) {
    split.fresh = messages.map((message) => ({ message, allowed: 0 }));
    return split;
  }
  const counts = countViolations(messages);
  for (const m of messages) {
    const key = violationKey(m);
    const allowed = key ? (b.files[m.file]?.[key] ?? 0) : 0;
    if (key && counts[m.file]![key]! <= allowed) {
      split.covered++;
      split.coveredByFile[m.file] = (split.coveredByFile[m.file] ?? 0) + 1;
    } else split.fresh.push({ message: m, allowed });
  }
  return split;
}

/**
 * Ratchet: lower baseline entries for `files` (all files when undefined) whose current count dropped.
 * Never raises a count. Returns true when the baseline changed.
 */
export function tightenBaseline(root: string, b: Baseline, messages: LintMessage[], files?: string[]): boolean {
  const counts = countViolations(messages);
  const inScope = files ? new Set(files.map((f) => path.relative(root, path.resolve(root, f)).split(path.sep).join("/"))) : null;
  let changed = false;
  for (const [file, keys] of Object.entries(b.files)) {
    if (inScope && !inScope.has(file)) continue;
    for (const [key, allowed] of Object.entries(keys)) {
      const now = counts[file]?.[key] ?? 0;
      if (now < allowed) {
        keys[key] = now;
        changed = true;
      }
    }
  }
  if (changed) writeBaseline(root, b);
  return changed;
}

/** Capture every current violation as accepted (`fcs baseline`). */
export function captureBaseline(root: string, messages: LintMessage[]): { files: number; violations: number } {
  const files = countViolations(messages);
  writeBaseline(root, { version: 1, files });
  const violations = Object.values(files).reduce((n, keys) => n + Object.values(keys).reduce((a, b) => a + b, 0), 0);
  return { files: Object.keys(files).length, violations };
}
