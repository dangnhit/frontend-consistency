import path from "node:path";
import { COMPONENTS_DIR, DESIGN_DIR, GENERATED_PARAMS_FILE } from "@frontend-consistency/core";
import { LOCK_FILE } from "../lock.js";
import { check } from "./check.js";

/** Subset of the Claude Code hook payload we rely on. */
export interface HookInput {
  cwd?: string;
  tool_name?: string;
  tool_input?: { file_path?: string; path?: string };
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
