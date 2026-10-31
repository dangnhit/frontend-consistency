import path from "node:path";
import { ESLint } from "eslint";
import fcs from "@frontend-consistency/eslint-plugin";

export interface LintMessage {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warn";
  message: string;
}

const DEFAULT_IGNORES = ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/out/**", "**/build/**", "**/coverage/**"];

/**
 * Lint with fcs rules only, inline config disabled, so `eslint-disable` comments cannot hide contract violations.
 * Independent of the project's own ESLint config.
 */
export async function lintContract(root: string, files?: string[]): Promise<LintMessage[]> {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [{ ignores: DEFAULT_IGNORES }, ...fcs.config({ root })],
    allowInlineConfig: false,
    errorOnUnmatchedPattern: false,
  });
  const targets = files?.length ? files : ["."];
  const results = await eslint.lintFiles(targets);
  const out: LintMessage[] = [];
  for (const r of results) {
    for (const m of r.messages) {
      out.push({
        file: path.relative(root, r.filePath).split(path.sep).join("/"),
        line: m.line ?? 0,
        column: m.column ?? 0,
        severity: m.severity === 2 ? "error" : "warn",
        message: m.message,
      });
    }
  }
  return out;
}
