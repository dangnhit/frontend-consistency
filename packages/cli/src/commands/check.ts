import { existsSync } from "node:fs";
import path from "node:path";
import {
  COMPONENTS_DIR,
  ContractError,
  generateFiles,
  loadContract,
  resolveContract,
  writeGenerated,
  type ResolvedContract,
} from "@gwinnguyen/fcs-core";
import { applyBaseline, readBaseline, tightenBaseline } from "../baseline.js";
import { lintContract, type LintMessage } from "../lint.js";
import { verifyLock } from "../lock.js";

export type Format = "pretty" | "agent";

export interface CheckOptions {
  files?: string[];
  format?: Format;
  /** Skip contract/lock/staleness checks; lint only (fast path for editor hooks). */
  lintOnly?: boolean;
  /** Apply `.design/baseline.json` (default true). False reports every violation. */
  baseline?: boolean;
  /** Lower baseline counts that dropped (default: true unless `lintOnly`). */
  tighten?: boolean;
}

export interface CheckResult {
  errors: number;
  warnings: number;
  report: string;
  /** Violations accepted by the baseline (not counted in errors/warnings). */
  baselined: number;
  /** file → baselined violation count. */
  baselinedByFile: Record<string, number>;
  /** The baseline was lowered because violations were fixed. */
  tightened: boolean;
}

interface Finding {
  where: string;
  severity: "error" | "warn";
  message: string;
}

export async function check(root: string, opts: CheckOptions = {}): Promise<CheckResult> {
  const findings: Finding[] = [];

  if (!opts.lintOnly) {
    let resolved: ResolvedContract;
    try {
      resolved = resolveContract(loadContract(root));
      const stale = writeGenerated(generateFiles(resolved, root), root, { dryRun: true }).filter((r) => r.changed);
      for (const s of stale) {
        findings.push({ where: s.file, severity: "error", message: "out of date with .design/ — run `fcs build`." });
      }
    } catch (e) {
      if (!(e instanceof ContractError)) throw e;
      for (const i of e.issues) findings.push({ where: i.file, severity: "error", message: i.message });
      return { ...summarize(findings, opts.format ?? "pretty", root), baselined: 0, baselinedByFile: {}, tightened: false };
    }
    for (const i of verifyLock(root, resolved)) findings.push({ where: i.file, severity: "error", message: i.message });
  }

  const lint: LintMessage[] = await lintContract(root, opts.files);
  const baseline = opts.baseline === false ? null : readBaseline(root);
  const split = applyBaseline(lint, baseline);
  for (const { message: m, allowed } of split.fresh) {
    const note = allowed ? ` (baseline allows ${allowed} in this file; this change added more)` : "";
    findings.push({ where: `${m.file}:${m.line}:${m.column}`, severity: m.severity, message: `${m.message}${note}` });
  }
  const tightened = !!baseline && (opts.tighten ?? !opts.lintOnly) && tightenBaseline(root, baseline, lint, opts.files);

  return {
    ...summarize(findings, opts.format ?? "pretty", root, split.covered, tightened),
    baselined: split.covered,
    baselinedByFile: split.coveredByFile,
    tightened,
  };
}

/** `@/components/fcs/<name>` modules that findings point to but the project has not installed yet. */
function missingComponents(findings: Finding[], root: string): string[] {
  const names = new Set<string>();
  for (const f of findings) {
    for (const m of f.message.matchAll(/@\/components\/fcs\/([a-z0-9-]+)/g)) names.add(m[1]!);
  }
  const exts = [".tsx", ".ts", ".jsx", ".js"];
  return [...names].filter((n) => !exts.some((e) => existsSync(path.join(root, COMPONENTS_DIR, `${n}${e}`)))).sort();
}

type Summary = Pick<CheckResult, "errors" | "warnings" | "report">;

function summarize(findings: Finding[], format: Format, root: string, baselined = 0, tightened = false): Summary {
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;
  const extra: string[] = [];
  if (format !== "agent") {
    if (baselined) extra.push(`· ${baselined} existing violation(s) accepted by ${".design/baseline.json"} — \`fcs check --no-baseline\` lists them`);
    if (tightened) extra.push("✓ baseline tightened: fixed violations can no longer come back");
  }
  if (!findings.length) {
    return { errors, warnings, report: format === "agent" ? "" : ["fcs: contract satisfied ✓", ...extra].join("\n") };
  }

  const lines = findings.map((f) => `${f.where}  ${f.severity === "warn" ? "warning" : "error"}  ${f.message}`);
  const missing = missingComponents(findings, root);
  if (missing.length) lines.push(`Not installed yet: run \`npx fcs add ${missing.join(" ")}\` first.`);
  if (format === "agent") {
    lines.unshift(`UI contract violations (${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}). Fix each before continuing:`);
    lines.push(
      "Use the named component instead of re-implementing it. Do not add eslint-disable comments and do not edit components/fcs/** or .design/lock.json.",
    );
  } else {
    lines.push("", `fcs: ${errors} error(s), ${warnings} warning(s)`, ...extra);
  }
  return { errors, warnings, report: lines.join("\n") };
}
