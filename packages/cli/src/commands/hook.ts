import { spawnSync } from "node:child_process";
import path from "node:path";
import { COMPONENTS_DIR, DESIGN_DIR, GENERATED_PARAMS_FILE } from "@frontend-consistency/core";
import { LOCK_FILE } from "../lock.js";
import { check } from "./check.js";

/** Subset of the Claude Code hook payload we rely on. */
export interface HookInput {
  cwd?: string;
  tool_name?: string;
  tool_input?: { file_path?: string; path?: string };
  /** Stop hook: true when the agent is already continuing because of a previous Stop block. */
  stop_hook_active?: boolean;
}

export interface HookOutput {
  /** 0 = allow / clean; 2 = block (pre) or feed stderr back to the model (post). */
  code: 0 | 2;
  stderr: string;
}

const LINTABLE = /\.(jsx?|tsx?|mjs|cjs|mts|cts)$/;

function target(input: HookInput, root: string): string | null {
  const file = input.tool_input?.file_path ?? input.tool_input?.path;
  if (!file) return null;
  return path.relative(root, path.resolve(input.cwd ?? root, file)).split(path.sep).join("/");
}

/** PreToolUse: deny edits to locked components and the lock file. */
export function hookPre(input: HookInput, root: string): HookOutput {
  const rel = target(input, root);
  if (!rel) return { code: 0, stderr: "" };
  if (rel === GENERATED_PARAMS_FILE) {
    return { code: 2, stderr: `${rel} is generated. Change .design/ and run \`fcs build\` instead of editing it.` };
  }
  if (rel.startsWith(`${COMPONENTS_DIR}/`) || rel === LOCK_FILE) {
    return {
      code: 2,
      stderr:
        `${rel} is locked by the UI contract. Use the component as-is; change its behaviour through .design/ params (then \`fcs build\`). ` +
        `If the component itself is wrong, stop and ask the user — do not work around it.`,
    };
  }
  return { code: 0, stderr: "" };
}

/** PostToolUse: lint the edited file and feed contract violations back to the agent. */
export async function hookPost(input: HookInput, root: string): Promise<HookOutput> {
  const rel = target(input, root);
  if (!rel || rel.startsWith("..") || !LINTABLE.test(rel) || rel.startsWith(`${DESIGN_DIR}/`)) return { code: 0, stderr: "" };
  const res = await check(root, { files: [rel], format: "agent", lintOnly: true });
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
