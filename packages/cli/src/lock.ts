import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  COMPONENTS_DIR,
  DESIGN_DIR,
  GENERATED_PARAMS_FILE,
  parseRef,
  resolveModuleFile,
  type ResolvedContract,
} from "@gwinnguyen/fcs-core";

export const LOCK_FILE = `${DESIGN_DIR}/lock.json`;

export interface LockFile {
  version: 1;
  /** Registry installs: relative path → sha256 of the content as installed by `fcs add`. */
  files: Record<string, string>;
  /** Project-owned locked files (`fcs lock`, canonical pattern components, ejected registry files) → sha256. */
  project: Record<string, string>;
  /** Legacy (v0.1): files unlocked with a decision record; no longer written. */
  ejected: Record<string, string>;
}

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function readLock(root: string): LockFile {
  const file = path.join(root, LOCK_FILE);
  if (!existsSync(file)) return { version: 1, files: {}, project: {}, ejected: {} };
  const data = JSON.parse(readFileSync(file, "utf8")) as Partial<LockFile>;
  return { version: 1, files: data.files ?? {}, project: data.project ?? {}, ejected: data.ejected ?? {} };
}

export function writeLock(root: string, lock: LockFile): void {
  const sorted = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    path.join(root, LOCK_FILE),
    `${JSON.stringify(
      {
        version: 1,
        files: sorted(lock.files),
        project: sorted(lock.project),
        ...(Object.keys(lock.ejected).length && { ejected: sorted(lock.ejected) }),
      },
      null,
      2,
    )}\n`,
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

/** Whether `rel` (POSIX, relative to root) is locked against agent edits. */
export function isLocked(lock: LockFile, rel: string): boolean {
  return rel in lock.files || rel in lock.project;
}

export interface CanonicalFile {
  file: string;
  patterns: string[];
}

/**
 * Project files that implement a pattern's `use` / `root` components and should be locked (`lock: true`, the default).
 * Refs that resolve outside the project (packages, a parent app) are skipped — their own project locks them.
 */
export function canonicalFiles(root: string, resolved: ResolvedContract): CanonicalFile[] {
  const byFile = new Map<string, Set<string>>();
  for (const p of resolved.patterns) {
    if (!p.lock || p.severity === "off") continue;
    for (const ref of [...p.use, ...p.root]) {
      const abs = resolveModuleFile(parseRef(ref).module, path.join(p.base, "_"), p.base);
      if (!abs) continue;
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
      (byFile.get(rel) ?? byFile.set(rel, new Set()).get(rel)!).add(p.id);
    }
  }
  return [...byFile].map(([file, ids]) => ({ file, patterns: [...ids].sort() })).sort((a, b) => a.file.localeCompare(b.file));
}

const UPDATE_HINT = "Agents must not edit it. If the change is intended, a person runs `fcs lock --update <file> --reason \"…\"`.";

export function verifyLock(root: string, resolved?: ResolvedContract): LockIssue[] {
  const lock = readLock(root);
  const issues: LockIssue[] = [];
  for (const file of componentFiles(root)) {
    if (lock.ejected[file] || file in lock.project) continue;
    const expected = lock.files[file];
    if (!expected) {
      issues.push({ file, message: "not installed through `fcs add` (unknown to .design/lock.json). Locked components come from the @fcs registry." });
    } else if (sha256(readFileSync(path.join(root, file))) !== expected) {
      issues.push({ file, message: "modified after install. Locked components must not be edited — change .design/ params, or take ownership with `fcs eject <file> --reason \"…\"`." });
    }
  }
  for (const file of Object.keys(lock.files)) {
    if (!existsSync(path.join(root, file))) issues.push({ file, message: "listed in .design/lock.json but missing. Reinstall with `fcs add`." });
  }
  for (const [file, hash] of Object.entries(lock.project)) {
    const abs = path.join(root, file);
    if (!existsSync(abs)) issues.push({ file, message: "locked in .design/lock.json but missing. Restore it, or `fcs unlock` it with a reason." });
    else if (sha256(readFileSync(abs)) !== hash) issues.push({ file, message: `modified after it was locked. ${UPDATE_HINT}` });
  }
  if (resolved) {
    for (const c of canonicalFiles(root, resolved)) {
      if (!isLocked(lock, c.file)) {
        issues.push({ file: c.file, message: `canonical component of pattern ${c.patterns.map((p) => `"${p}"`).join(", ")} is not locked — run \`fcs build\`.` });
      }
    }
  }
  return issues;
}
