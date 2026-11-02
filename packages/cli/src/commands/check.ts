import {
  ContractError,
  generateFiles,
  loadContract,
  resolveContract,
  writeGenerated,
} from "@gwinnguyen/fcs-core";
import { lintContract, type LintMessage } from "../lint.js";
import { verifyLock } from "../lock.js";

export type Format = "pretty" | "agent";

export interface CheckOptions {
  files?: string[];
  format?: Format;
  /** Skip contract/lock/staleness checks; lint only (fast path for editor hooks). */
  lintOnly?: boolean;
}

export interface CheckResult {
  errors: number;
  warnings: number;
  report: string;
}

interface Finding {
  where: string;
  severity: "error" | "warn";
  message: string;
}

export async function check(root: string, opts: CheckOptions = {}): Promise<CheckResult> {
  const findings: Finding[] = [];

  if (!opts.lintOnly) {
    try {
      const resolved = resolveContract(loadContract(root));
      const stale = writeGenerated(generateFiles(resolved, root), root, { dryRun: true }).filter((r) => r.changed);
      for (const s of stale) {
        findings.push({ where: s.file, severity: "error", message: "out of date with .design/ — run `fcs build`." });
      }
    } catch (e) {
      if (!(e instanceof ContractError)) throw e;
      for (const i of e.issues) findings.push({ where: i.file, severity: "error", message: i.message });
      return summarize(findings, opts.format ?? "pretty");
    }
    for (const i of verifyLock(root)) findings.push({ where: i.file, severity: "error", message: i.message });
  }

  const lint: LintMessage[] = await lintContract(root, opts.files);
  for (const m of lint) findings.push({ where: `${m.file}:${m.line}:${m.column}`, severity: m.severity, message: m.message });

  return summarize(findings, opts.format ?? "pretty");
}

function summarize(findings: Finding[], format: Format): CheckResult {
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;
  if (!findings.length) return { errors, warnings, report: format === "agent" ? "" : "fcs: contract satisfied ✓" };

  const lines = findings.map((f) => `${f.where}  ${f.severity === "warn" ? "warning" : "error"}  ${f.message}`);
  if (format === "agent") {
    lines.unshift(`UI contract violations (${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}). Fix each before continuing:`);
    lines.push(
      "Use the named component instead of re-implementing it. Do not add eslint-disable comments and do not edit components/fcs/** or .design/lock.json.",
    );
  } else {
    lines.push("", `fcs: ${errors} error(s), ${warnings} warning(s)`);
  }
  return { errors, warnings, report: lines.join("\n") };
}
