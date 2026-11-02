import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isMap, parseDocument, type YAMLMap } from "yaml";
import { MARK_END, MARK_START } from "./generate.js";
import type { ResolvedContract } from "./resolve.js";
import type { ParamValue } from "./schema.js";

/** One rule-like unit of prose: a list item (with continuation lines) or a paragraph. */
export interface Statement {
  line: number;
  text: string;
  heading: string;
}

export interface Evidence {
  line: number;
  sentence: string;
  /** True when the sentence rejects a value ("do not use skeletons") rather than choosing one. */
  negated: boolean;
  /** The value the sentence speaks about, before negation is applied. */
  mentioned: string;
}

export interface ParamFinding {
  ruleId: string;
  param: string;
  /** Value currently in effect (preset + overrides). */
  current: ParamValue | undefined;
  /** Value → sentences that vote for it. */
  votes: Map<string, Evidence[]>;
  /** Present when every vote agrees. */
  agreed?: ParamValue;
}

export interface ImportAnalysis {
  statements: number;
  /** Statements that touched at least one detectable param. */
  mapped: Set<number>;
  findings: ParamFinding[];
}

const NEGATION = /\b(?:do not|don't|never|avoid|must not|should not|no)\b[^,;:]*$/i;

/** Markdown → statements. Skips code fences and the region `fcs build` writes. */
export function extractStatements(markdown: string): Statement[] {
  const out: Statement[] = [];
  let heading = "";
  let current: Statement | null = null;
  let inFence = false;
  let inGenerated = false;
  const flush = () => {
    if (current?.text.trim()) out.push({ ...current, text: current.text.replace(/\s+/g, " ").trim() });
    current = null;
  };

  markdown.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (raw.includes(MARK_START)) inGenerated = true;
    if (raw.includes(MARK_END)) {
      inGenerated = false;
      return;
    }
    if (inGenerated) return;
    if (/^\s*(```|~~~)/.test(raw)) {
      flush();
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    const h = /^#{1,6}\s+(.*)$/.exec(raw);
    if (h) {
      flush();
      heading = h[1]!.trim();
      return;
    }
    if (!raw.trim()) {
      flush();
      return;
    }
    const item = /^\s*(?:[-*+]|\d+[a-z]?[.)])\s+(.*)$/.exec(raw);
    if (item) {
      flush();
      current = { line, text: item[1]!, heading };
      return;
    }
    if (current) current.text += ` ${raw.trim()}`;
    else current = { line, text: raw.trim(), heading };
  });
  flush();
  return out;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z"'`(])/).filter((s) => s.trim());
}

function rx(source: string): RegExp {
  return new RegExp(source, "i");
}

/**
 * Map prose statements onto rule params declared with `detect:`. Each sentence votes for at most one value
 * per param. A negated mention of one value in a two-value enum counts as a vote for the other value.
 */
export function analyzeDesignDoc(markdown: string, resolved: ResolvedContract): ImportAnalysis {
  const statements = extractStatements(markdown);
  const mapped = new Set<number>();
  const findings: ParamFinding[] = [];

  for (const rule of resolved.rules) {
    if (!rule.detect) continue;
    const topic = rx(rule.detect.topic);
    const ignore = rule.detect.ignore ? rx(rule.detect.ignore) : null;

    for (const [param, spec] of Object.entries(rule.detect.params)) {
      const finding: ParamFinding = { ruleId: rule.id, param, current: rule.params[param], votes: new Map() };
      const vote = (value: string, ev: Evidence) => {
        const list = finding.votes.get(value) ?? [];
        list.push(ev);
        finding.votes.set(value, list);
      };

      for (const st of statements) {
        if (!topic.test(st.text)) continue;
        for (const sentence of sentences(st.text)) {
          if (ignore?.test(sentence)) continue;

          if ("number" in spec) {
            const m = rx(spec.number).exec(sentence);
            if (m?.[1]) {
              vote(m[1], { line: st.line, sentence, negated: false, mentioned: m[1] });
              mapped.add(st.line);
            }
            continue;
          }

          const values = Object.keys(spec.values);
          let hit: { value: string; index: number } | null = null;
          for (const value of values) {
            const m = rx(spec.values[value]!).exec(sentence);
            if (m && (!hit || m.index < hit.index)) hit = { value, index: m.index };
          }
          if (!hit) continue;
          const negated = NEGATION.test(sentence.slice(0, hit.index));
          mapped.add(st.line);
          if (!negated) vote(hit.value, { line: st.line, sentence, negated, mentioned: hit.value });
          else if (values.length === 2) {
            vote(values.find((v) => v !== hit!.value)!, { line: st.line, sentence, negated, mentioned: hit.value });
          }
        }
      }

      if (finding.votes.size === 0) continue;
      if (finding.votes.size === 1) {
        const [value] = finding.votes.keys();
        finding.agreed = "number" in spec ? Number(value) : value!;
      }
      findings.push(finding);
    }
  }
  return { statements: statements.length, mapped, findings };
}

export interface ImportDecision {
  ruleId: string;
  param: string;
  value: ParamValue;
}

/**
 * Write param overrides into contract.yaml, keeping comments and layout. Values equal to what is already in
 * effect are skipped. Returns the decisions actually written.
 */
export function writeOverrides(
  contractFile: string,
  decisions: ImportDecision[],
  resolved: ResolvedContract,
): ImportDecision[] {
  const doc = parseDocument(existsSync(contractFile) ? readFileSync(contractFile, "utf8") : "");
  const written: ImportDecision[] = [];
  for (const d of decisions) {
    const rule = resolved.rules.find((r) => r.id === d.ruleId);
    if (rule && rule.params[d.param] === d.value) continue;
    doc.setIn(["overrides", d.ruleId, "params", d.param], d.value);
    written.push(d);
  }
  if (!written.length) return written;
  const overrides = doc.get("overrides", true);
  if (isMap(overrides)) {
    (overrides as YAMLMap).flow = false;
    for (const pair of (overrides as YAMLMap).items) {
      if (isMap(pair.value)) {
        pair.value.flow = false;
        const params = pair.value.get("params", true);
        if (isMap(params)) params.flow = false;
      }
    }
  }
  writeFileSync(contractFile, doc.toString());
  return written;
}
