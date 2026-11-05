import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { COMPONENTS_DIR, DESIGN_DIR, GENERATED_PARAMS_FILE } from "@gwinnguyen/fcs-core";
import { LOCK_FILE } from "../lock.js";
import { check } from "./check.js";

/**
 * Subset of the hook payload we rely on. Claude Code sends `tool_input.file_path` for Edit/Write/MultiEdit;
 * Codex sends the patch text in `tool_input.command` for `apply_patch`.
 */
export interface HookInput {
  cwd?: string;
  tool_name?: string;
  tool_input?: { file_path?: string; path?: string; command?: string | string[]; input?: string };
  /** Stop hook: true when the agent is already continuing because of a previous Stop block. */
  stop_hook_active?: boolean;
}

export interface HookOutput {
  /** 0 = allow / clean; 2 = block (pre) or feed stderr back to the model (post). */
  code: 0 | 2;
  stderr: string;
}

const LINTABLE = /\.(jsx?|tsx?|mjs|cjs|mts|cts)$/;

/** Paths named in a Codex `apply_patch` body (`*** Add|Update|Delete File: …`, `*** Move to: …`). */
export function patchFiles(patch: string): string[] {
  return [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+?)\s*$/gm)].map((m) => m[1]!);
}

function patchText(input: HookInput): string | null {
  const t = input.tool_input;
  const raw = t?.input ?? t?.command;
  const text = Array.isArray(raw) ? raw.join("\n") : raw;
  return text && text.includes("*** Begin Patch") ? text : null;
}

/** Files the tool call writes, relative to root with forward slashes. */
export function targets(input: HookInput, root: string): string[] {
  const file = input.tool_input?.file_path ?? input.tool_input?.path;
  const patch = patchText(input);
  const files = file ? [file] : patch ? patchFiles(patch) : [];
  return files.map((f) => path.relative(root, path.resolve(input.cwd ?? root, f)).split(path.sep).join("/"));
}

/** Nearest directory at or above `from` that has a `.design/` folder; `from` itself when none does. */
export function findRoot(from: string): string {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, DESIGN_DIR))) return dir;
    if (path.dirname(dir) === dir) return path.resolve(from);
  }
}

function lockedReason(rel: string, root: string): string | null {
  if (rel === GENERATED_PARAMS_FILE) return `${rel} is generated. Change .design/ and run \`fcs build\` instead of editing it.`;
  if (rel.startsWith(`${COMPONENTS_DIR}/`) && !existsSync(path.join(root, rel))) {
    const name = path.basename(rel).replace(/\.[^.]+$/, "");
    return (
      `${rel} is not installed. Install it with \`npx fcs add ${name}\` (it is pulled from the @fcs registry and locked) ` +
      `instead of writing it by hand.`
    );
  }
  if (rel.startsWith(`${COMPONENTS_DIR}/`) || rel === LOCK_FILE) {
    return (
      `${rel} is locked by the UI contract. Use the component as-is; change its behaviour through .design/ params (then \`fcs build\`). ` +
      `If the component itself is wrong, stop and ask the user — do not work around it.`
    );
  }
  return null;
}

/** PreToolUse: deny edits to locked components and the lock file. */
export function hookPre(input: HookInput, root: string): HookOutput {
  const reasons = targets(input, root).map((rel) => lockedReason(rel, root)).filter((r): r is string => r !== null);
  return reasons.length ? { code: 2, stderr: reasons.join("\n") } : { code: 0, stderr: "" };
}

/** PostToolUse: lint the edited file(s) and feed contract violations back to the agent. */
export async function hookPost(input: HookInput, root: string): Promise<HookOutput> {
  const files = targets(input, root).filter(
    (rel) => !rel.startsWith("..") && LINTABLE.test(rel) && !rel.startsWith(`${DESIGN_DIR}/`) && existsSync(path.join(root, rel)),
  );
  if (!files.length) return { code: 0, stderr: "" };
  const res = await check(root, { files, format: "agent", lintOnly: true });
  return res.errors > 0 ? { code: 2, stderr: res.report } : { code: 0, stderr: "" };
}

/** Files changed in the working tree (relative to root), or null when root is not inside a git repo. */
export function changedFiles(root: string): string[] | null {
  const git = (args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  const diff = git(["diff", "--name-only", "--relative", "HEAD"]);
  if (diff.status !== 0) return null;
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  const all = `${diff.stdout}\n${untracked.stdout}`.split("\n").map((f) => f.trim()).filter(Boolean);
  return [...new Set(all)];
}

/**
 * Stop: full contract check before the agent finishes. Backstop for writes that bypass the Edit/Write hooks
 * (shell heredocs, codegen scripts) and for tampering with locked files. Lints changed files when git knows them,
 * otherwise the whole project. Blocks once; if the agent is already continuing from a block, it lets it stop
 * (pre-commit / CI remain the hard gate) to avoid an endless loop.
 */
export async function hookStop(input: HookInput, root: string): Promise<HookOutput> {
  if (input.stop_hook_active) return { code: 0, stderr: "" };
  const changed = changedFiles(root);
  const files = changed?.filter((f) => LINTABLE.test(f) && !f.startsWith(`${DESIGN_DIR}/`));
  if (changed && files && files.length === 0 && !changed.some((f) => f.startsWith(`${COMPONENTS_DIR}/`) || f.startsWith(`${DESIGN_DIR}/`))) {
    return { code: 0, stderr: "" };
  }
  const res = await check(root, { files: files?.length ? files : undefined, format: "agent" });
  return res.errors > 0 ? { code: 2, stderr: res.report } : { code: 0, stderr: "" };
}
