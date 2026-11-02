import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  analyzeDesignDoc,
  DESIGN_DIR,
  loadContract,
  resolveContract,
  writeOverrides,
  type Evidence,
  type ImportDecision,
  type ParamFinding,
  type ParamValue,
} from "@gwinnguyen/fcs-core";
import { build } from "./build.js";

export interface ImportOptions {
  /** `rule.id.param=value` choices that settle conflicts (or override an agreed value). */
  decide?: string[];
  /** Apply: write overrides + decision record, then rebuild. Without it, only report. */
  write?: boolean;
}

export interface ImportResult {
  report: string;
  conflicts: number;
  written: ImportDecision[];
  decisionFile?: string;
}

const key = (f: { ruleId: string; param: string }) => `${f.ruleId}.${f.param}`;

function parseDecisions(raw: string[], findings: ParamFinding[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of raw) {
    const eq = d.indexOf("=");
    const k = d.slice(0, eq);
    if (eq < 1 || !findings.some((f) => key(f) === k)) {
      const known = findings.map(key).join(", ") || "none found in this document";
      throw new Error(`--decide "${d}": expected <rule.id>.<param>=<value>; params found: ${known}`);
    }
    out.set(k, d.slice(eq + 1));
  }
  return out;
}

function coerce(value: string, current: ParamValue | undefined): ParamValue {
  if (typeof current === "number" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  if (typeof current === "boolean") return value === "true";
  return value;
}

function quote(ev: Evidence, doc: string): string {
  const s = ev.sentence.length > 110 ? `${ev.sentence.slice(0, 107)}…` : ev.sentence;
  return `${doc}:${ev.line}  "${s}"${ev.negated ? ` (rejects ${ev.mentioned})` : ""}`;
}

/** Lines that argue for a value other than the chosen one — the prose to fix so agents stop reading both. */
function losers(f: ParamFinding, chosen: string): Evidence[] {
  return [...f.votes.entries()].filter(([v]) => v !== chosen).flatMap(([, evs]) => evs);
}

function nextDecisionFile(root: string, slug: string): string {
  const dir = path.join(root, DESIGN_DIR, "decisions");
  mkdirSync(dir, { recursive: true });
  const n = readdirSync(dir)
    .map((f) => /^(\d{4})-/.exec(f)?.[1])
    .filter(Boolean)
    .map(Number)
    .reduce((a, b) => Math.max(a, b), 0);
  return path.join(dir, `${String(n + 1).padStart(4, "0")}-import-${slug}.md`);
}

export function importDesignDoc(root: string, docPath: string, opts: ImportOptions = {}): ImportResult {
  const abs = path.resolve(root, docPath);
  if (!existsSync(abs)) throw new Error(`${docPath} not found`);
  const inRoot = !path.relative(root, abs).startsWith("..");
  const doc = path.relative(inRoot ? root : process.cwd(), abs);
  const loaded = loadContract(root);
  const resolved = resolveContract(loaded);
  const analysis = analyzeDesignDoc(readFileSync(abs, "utf8"), resolved);
  const decided = parseDecisions(opts.decide ?? [], analysis.findings);

  const lines: string[] = [
    `fcs import ${doc}: ${analysis.statements} statements, ${analysis.mapped.size} map to contract params, ` +
      `${analysis.statements - analysis.mapped.size} stay prose (not enforced).`,
  ];
  const decisions: ImportDecision[] = [];
  const record: string[] = [];
  let conflicts = 0;

  for (const f of analysis.findings) {
    const k = key(f);
    const choice = decided.get(k);
    const conflicting = f.agreed === undefined;
    lines.push("");

    if (conflicting && choice === undefined) {
      conflicts++;
      lines.push(`CONFLICT ${k}  (in effect: ${String(f.current)})`);
      for (const [value, evs] of f.votes) {
        lines.push(`  ${value}`);
        for (const ev of evs) lines.push(`    ${quote(ev, doc)}`);
      }
      lines.push(`  → pick one: --decide ${k}=${[...f.votes.keys()].join("|")}`);
      continue;
    }

    const value = coerce(choice ?? String(f.agreed), f.current);
    const same = value === f.current;
    lines.push(`${conflicting ? "DECIDED" : "FOUND"} ${k} = ${String(value)}  ${same ? "(already in effect)" : `(in effect: ${String(f.current)} → override)`}`);
    for (const ev of f.votes.get(String(value)) ?? []) lines.push(`    ${quote(ev, doc)}`);
    const stale = losers(f, String(value));
    if (stale.length) {
      lines.push(`  update or delete these lines in ${doc} — agents read them as instructions:`);
      for (const ev of stale) lines.push(`    ${quote(ev, doc)}`);
    }
    decisions.push({ ruleId: f.ruleId, param: f.param, value });
    record.push(
      `- \`${k}\` = \`${String(value)}\`${conflicting ? " — chosen to settle a conflict" : ""}`,
      ...(f.votes.get(String(value)) ?? []).map((ev) => `  - for: ${quote(ev, doc)}`),
      ...stale.map((ev) => `  - against (fix in ${doc}): ${quote(ev, doc)}`),
    );
  }

  if (!analysis.findings.length) lines.push("", "No statements match a detectable rule param.");

  const result: ImportResult = { report: "", conflicts, written: [] };
  if (!opts.write) {
    if (analysis.findings.length) {
      lines.push(
        "",
        conflicts
          ? `${conflicts} conflict(s). Ask the team which value to keep, then re-run with --decide … --write.`
          : "Re-run with --write to apply.",
      );
    }
    result.report = lines.join("\n");
    return result;
  }
  if (conflicts) {
    lines.push("", `Not written: ${conflicts} conflict(s) need --decide.`);
    result.report = lines.join("\n");
    return result;
  }

  result.written = writeOverrides(loaded.contractFile, decisions, resolved);
  if (decisions.length) {
    const slug = path.basename(doc).replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const file = nextDecisionFile(root, slug);
    writeFileSync(
      file,
      [
        `# Import ${doc}`,
        "",
        `Imported with \`fcs import\`. ${analysis.mapped.size} of ${analysis.statements} statements map to contract params; the rest stay prose.`,
        "",
        "## Decisions",
        "",
        ...record,
        "",
        "## Overrides written",
        "",
        ...(result.written.length
          ? result.written.map((d) => `- \`overrides.${d.ruleId}.params.${d.param}: ${String(d.value)}\``)
          : ["- none (every value was already in effect)"]),
        "",
      ].join("\n"),
    );
    result.decisionFile = path.relative(root, file);
    lines.push("", `✓ ${result.written.length} override(s) written to ${path.relative(root, loaded.contractFile)}`, `✓ recorded ${result.decisionFile}`);
    for (const w of build(root).filter((x) => x.changed)) lines.push(`✓ generated ${w.file}`);
  }
  result.report = lines.join("\n");
  return result;
}
