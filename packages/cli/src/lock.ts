import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { COMPONENTS_DIR, DESIGN_DIR, GENERATED_PARAMS_FILE } from "@gwinnguyen/fcs-core";

export const LOCK_FILE = `${DESIGN_DIR}/lock.json`;

export interface LockFile {
  version: 1;
  /** Relative path → sha256 of the content as installed from the registry. */
  files: Record<string, string>;
  /** Files deliberately unlocked with `fcs eject`, with the decision that justifies it. */
  ejected: Record<string, string>;
}

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function readLock(root: string): LockFile {
  const file = path.join(root, LOCK_FILE);
  if (!existsSync(file)) return { version: 1, files: {}, ejected: {} };
  const data = JSON.parse(readFileSync(file, "utf8")) as Partial<LockFile>;
  return { version: 1, files: data.files ?? {}, ejected: data.ejected ?? {} };
}

export function writeLock(root: string, lock: LockFile): void {
  const sorted = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    path.join(root, LOCK_FILE),
    `${JSON.stringify({ version: 1, files: sorted(lock.files), ejected: sorted(lock.ejected) }, null, 2)}\n`,
  );
}

/** Locked-component files on disk (excluding the generated params module, which `fcs build` owns). */
export function componentFiles(root: string): string[] {
  const dir = path.join(root, COMPONENTS_DIR);
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push(path.relative(root, abs).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out.filter((f) => f !== GENERATED_PARAMS_FILE).sort();
}

export interface LockIssue {
  file: string;
  message: string;
}

export function verifyLock(root: string): LockIssue[] {
  const lock = readLock(root);
  const issues: LockIssue[] = [];
  for (const file of componentFiles(root)) {
    if (lock.ejected[file]) continue;
    const expected = lock.files[file];
    if (!expected) {
      issues.push({ file, message: "not installed through `fcs add` (unknown to .design/lock.json). Locked components come from the @fcs registry." });
    } else if (sha256(readFileSync(path.join(root, file))) !== expected) {
      issues.push({ file, message: "modified after install. Locked components must not be edited — change .design/ params, or `fcs eject` with a decision record." });
    }
  }
  for (const file of Object.keys(lock.files)) {
    if (!existsSync(path.join(root, file))) issues.push({ file, message: "listed in .design/lock.json but missing. Reinstall with `fcs add`." });
  }
  return issues;
}
