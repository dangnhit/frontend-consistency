import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { COMPONENTS_DIR, loadContract, resolveContract } from "@gwinnguyen/fcs-core";
import { recordDecision } from "../decisions.js";
import { canonicalFiles, isLocked, LOCK_FILE, readLock, sha256, writeLock } from "../lock.js";

/**
 * Changing what is locked is a team decision, not something an agent does to get past a hook. These commands refuse
 * to run without an interactive terminal unless FCS_ALLOW_NONINTERACTIVE=1 (CI, scripts, tests).
 */
export function assertHuman(command: string): void {
  if (process.env.FCS_ALLOW_NONINTERACTIVE === "1") return;
  if (process.stdin.isTTY && process.stdout.isTTY) return;
  throw new Error(
    `\`fcs ${command}\` changes what agents may edit, so it needs a person at an interactive terminal. ` +
      "If you are an AI agent: stop and ask the user to run it. (Scripts/CI: set FCS_ALLOW_NONINTERACTIVE=1.)",
  );
}

function relFiles(root: string, files: string[]): string[] {
  if (!files.length) throw new Error("no files given");
  return files.map((f) => {
    const abs = path.resolve(root, f);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`${f} is outside the project`);
    if (rel === LOCK_FILE) throw new Error(`${LOCK_FILE} cannot lock itself`);
    if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`${f} is not a file`);
    return rel;
  });
}

const hashOf = (root: string, rel: string) => sha256(readFileSync(path.join(root, rel)));

export interface LockResult {
  changed: string[];
  decision?: string;
}

/** Lock project files against agent edits. Already-locked files are left alone (use `update` after a human edit). */
export function lock(root: string, files: string[], reason?: string): LockResult {
  const rels = relFiles(root, files);
  const l = readLock(root);
  const changed = rels.filter((rel) => !isLocked(l, rel));
  for (const rel of changed) l.project[rel] = hashOf(root, rel);
  if (!changed.length) return { changed };
  writeLock(root, l);
  if (!reason) return { changed };
  const decision = recordDecision(root, `lock-${path.basename(changed[0]!)}`, [
    `# Lock ${changed.map((f) => `\`${f}\``).join(", ")}`,
    "",
    reason,
  ]);
  return { changed, decision };
}

/** Accept a deliberate human edit to locked file(s): re-hash and record why. */
export function updateLock(root: string, files: string[], reason: string): LockResult {
  if (!reason?.trim()) throw new Error('--update needs --reason "…" (recorded in .design/decisions/)');
  const rels = relFiles(root, files);
  const l = readLock(root);
  for (const rel of rels) {
    if (rel in l.files) throw new Error(`${rel} is a registry component; take ownership first with \`fcs eject ${rel} --reason "…"\``);
    if (!(rel in l.project)) throw new Error(`${rel} is not locked; use \`fcs lock ${rel}\``);
  }
  const changed = rels.filter((rel) => l.project[rel] !== hashOf(root, rel));
  if (!changed.length) return { changed };
  for (const rel of changed) l.project[rel] = hashOf(root, rel);
  writeLock(root, l);
  const decision = recordDecision(root, `update-${path.basename(changed[0]!)}`, [
    `# Update locked ${changed.map((f) => `\`${f}\``).join(", ")}`,
    "",
    reason,
  ]);
  return { changed, decision };
}

/** Stop locking file(s). Canonical pattern components cannot be unlocked while the pattern locks them. */
export function unlock(root: string, files: string[], reason: string): LockResult {
  if (!reason?.trim()) throw new Error('unlock needs --reason "…" (recorded in .design/decisions/)');
  const rels = relFiles(root, files);
  const canonical = new Map(canonicalFiles(root, resolveContract(loadContract(root))).map((c) => [c.file, c.patterns]));
  const l = readLock(root);
  for (const rel of rels) {
    if (rel in l.files || rel.startsWith(`${COMPONENTS_DIR}/`)) throw new Error(`${rel} is a registry component; use \`fcs eject\``);
    const pats = canonical.get(rel);
    if (pats) throw new Error(`${rel} is the canonical component of pattern ${pats.join(", ")}; set \`lock: false\` on the pattern instead`);
  }
  const changed = rels.filter((rel) => rel in l.project);
  if (!changed.length) return { changed };
  for (const rel of changed) delete l.project[rel];
  writeLock(root, l);
  const decision = recordDecision(root, `unlock-${path.basename(changed[0]!)}`, [
    `# Unlock ${changed.map((f) => `\`${f}\``).join(", ")}`,
    "",
    reason,
  ]);
  return { changed, decision };
}

/**
 * Take ownership of registry component(s): they stay where they are and stay locked against agents, but the project
 * now edits them deliberately (`fcs lock --update`) and `fcs add` will no longer overwrite them silently.
 */
export function eject(root: string, files: string[], reason: string): LockResult {
  if (!reason?.trim()) throw new Error('eject needs --reason "…" (recorded in .design/decisions/)');
  const rels = files.map((f) => (f.includes("/") || f.includes(".") ? f : `${COMPONENTS_DIR}/${f}.tsx`));
  const l = readLock(root);
  for (const rel of relFiles(root, rels)) {
    if (!(rel in l.files)) throw new Error(`${rel} is not a registry component installed with \`fcs add\``);
  }
  const changed = relFiles(root, rels);
  for (const rel of changed) {
    delete l.files[rel];
    l.project[rel] = hashOf(root, rel);
  }
  writeLock(root, l);
  const decision = recordDecision(root, `eject-${path.basename(changed[0]!)}`, [
    `# Eject ${changed.map((f) => `\`${f}\``).join(", ")}`,
    "",
    "The project now owns these files. They stay locked against agents; people change them with `fcs lock --update`.",
    "",
    reason,
  ]);
  return { changed, decision };
}

/** Lock canonical pattern components that are not locked yet (run by `fcs build`). */
export function lockCanonical(root: string): { file: string; patterns: string[] }[] {
  const l = readLock(root);
  const added = canonicalFiles(root, resolveContract(loadContract(root))).filter((c) => !isLocked(l, c.file));
  if (!added.length) return [];
  for (const c of added) l.project[c.file] = hashOf(root, c.file);
  writeLock(root, l);
  return added;
}
