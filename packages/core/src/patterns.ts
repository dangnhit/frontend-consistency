import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isCollection, isMap, isPair, isSeq, parseDocument, type YAMLMap } from "yaml";
import { getConcern, moduleOf } from "./concerns.js";
import type { Issue, LoadedContract } from "./load.js";
import { compileGlobs } from "./resolve-globs.js";
import type { Forbid, RuleException, Severity } from "./schema.js";

export interface ResolvedPattern {
  id: string;
  concern: string;
  use: string[];
  root: string[];
  /** Globs relative to `base`; empty = every file under `base`. */
  files: string[];
  scopeInclude: string[];
  scopeExclude: string[];
  except: RuleException[];
  forbid: Forbid[];
  severity: Severity;
  status: "decided" | "proposed";
  why?: string;
  lock: boolean;
  /** Absolute root of the contract that declared the pattern; its globs are relative to it. */
  base: string;
  /** Declaring contract file, relative to the project being resolved. */
  origin: string;
  /** Contract depth: higher = closer to the project (child beats parent). */
  depth: number;
}

/** Catalog signals for the concern, minus imports of the canonical modules themselves. */
function defaultForbid(concern: string, use: string[]): Forbid[] {
  const canonical = new Set(use.map(moduleOf));
  return (getConcern(concern)?.signals ?? []).filter((f) => !("import" in f && canonical.has(moduleOf(f.import))));
}

/** Patterns from every contract layer, parent first; a child may redefine a parent pattern only with a `reason`. */
export function resolvePatterns(loaded: LoadedContract, issues: Issue[]): ResolvedPattern[] {
  const byId = new Map<string, ResolvedPattern>();
  const rel = (f: string) => path.relative(loaded.root, f) || f;

  for (const layer of loaded.patternLayers) {
    for (const [id, p] of Object.entries(layer.patterns)) {
      const prev = byId.get(id);
      if (prev && prev.base !== layer.root && !p.reason) {
        issues.push({
          file: layer.contractFile,
          message: `pattern "${id}" overrides the one in ${prev.origin}; add \`reason:\` saying why this app differs`,
        });
        continue;
      }
      const scopeInclude: string[] = [];
      const scopeExclude: string[] = [];
      for (const s of p.scope ?? []) {
        const def = layer.scopes[s];
        if (!def) {
          issues.push({ file: layer.contractFile, message: `pattern "${id}" uses undefined scope "${s}"` });
          continue;
        }
        scopeInclude.push(...def.include);
        scopeExclude.push(...def.exclude);
      }
      const concern = p.concern ?? id;
      const use = p.use ?? [];
      byId.set(id, {
        id,
        concern,
        use,
        root: p.root ?? [],
        files: p.files ?? [],
        scopeInclude,
        scopeExclude,
        except: p.except,
        forbid: p.forbid ?? defaultForbid(concern, [...use, ...(p.root ?? [])]),
        severity: p.severity,
        status: p.status,
        ...(p.why !== undefined && { why: p.why }),
        lock: p.lock,
        base: layer.root,
        origin: rel(layer.contractFile),
        depth: layer.depth,
      });
    }
  }
  return [...byId.values()];
}

/** Whether `p` applies to `absFile`. */
export function patternAppliesTo(p: ResolvedPattern, absFile: string): boolean {
  if (p.severity === "off") return false;
  const rel = path.relative(p.base, absFile).split(path.sep).join("/");
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
  if (p.files.length && !compileGlobs(p.files)(rel)) return false;
  if (p.scopeInclude.length && (!compileGlobs(p.scopeInclude)(rel) || compileGlobs(p.scopeExclude)(rel))) return false;
  return !p.except.some((e) => compileGlobs([e.path])(rel));
}

/**
 * Patterns in force for a file: per concern, the most specific applicable one wins —
 * the one with more restrictions (`files`, `scope`) wins, then a child contract beats its parent,
 * then declaration order.
 */
export function patternsFor(patterns: ResolvedPattern[], absFile: string): ResolvedPattern[] {
  const best = new Map<string, { p: ResolvedPattern; rank: number[] }>();
  patterns.forEach((p, order) => {
    if (!patternAppliesTo(p, absFile)) return;
    const rank = [(p.files.length ? 1 : 0) + (p.scopeInclude.length ? 1 : 0), p.depth, -order];
    const prev = best.get(p.concern);
    if (!prev || compareRank(rank, prev.rank) > 0) best.set(p.concern, { p, rank });
  });
  return [...best.values()].map((b) => b.p);
}

function compareRank(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/** `"@/components/app/loading-state#LoadingState"` → `{ module, name }`. */
export function parseRef(ref: string): { module: string; name: string } {
  const i = ref.lastIndexOf("#");
  return { module: ref.slice(0, i), name: ref.slice(i + 1) };
}

/**
 * Add or replace patterns in a contract file, keeping comments and layout (block style for what is written).
 * `value` is written as given (plain JSON-able object).
 */
export function writePatterns(
  contractFile: string,
  patterns: Record<string, Record<string, unknown>>,
  scopes: Record<string, { include: string[] }> = {},
): void {
  const doc = parseDocument(existsSync(contractFile) ? readFileSync(contractFile, "utf8") : "");
  for (const [name, def] of Object.entries(scopes)) doc.setIn(["scopes", name], doc.createNode(def));
  for (const [id, value] of Object.entries(patterns)) doc.setIn(["patterns", id], doc.createNode(value));
  // Block style for what we write — and for the root, which an empty contract (`{}`) starts as flow.
  const block = (node: unknown): void => {
    if (!isCollection(node)) return;
    if (node === doc.contents || isMap(node) || isSeq(node)) (node as YAMLMap).flow = false;
    for (const item of (node as YAMLMap).items) block(isPair(item) ? item.value : item);
  };
  if (isMap(doc.contents)) (doc.contents as YAMLMap).flow = false;
  block(doc.get("patterns", true));
  if (Object.keys(scopes).length) block(doc.get("scopes", true));
  writeFileSync(contractFile, doc.toString());
}
