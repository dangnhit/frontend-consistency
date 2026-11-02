import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Rule } from "eslint";
import {
  COMPONENTS_DIR,
  getRule,
  loadContract,
  resolveContract,
  ruleAppliesTo,
  type ResolvedContract,
  type ResolvedRule,
} from "@gwinnguyen/fcs-core";

type Loaded = { ok: true; resolved: ResolvedContract } | { ok: false; error: string };
const cache = new Map<string, Loaded>();

/** Project root: `settings.fcs.root`, else ESLint's cwd. */
export function projectRoot(context: Rule.RuleContext): string {
  const configured = (context.settings?.fcs as { root?: string } | undefined)?.root;
  return path.resolve(context.cwd, configured ?? ".");
}

export function loadResolved(root: string): Loaded {
  let entry = cache.get(root);
  if (!entry) {
    try {
      entry = { ok: true, resolved: resolveContract(loadContract(root)) };
    } catch (e) {
      entry = { ok: false, error: (e as Error).message };
    }
    cache.set(root, entry);
  }
  return entry;
}

/** For tests and long-running processes (editor) after `.design/` changes. */
export function clearContractCache(): void {
  cache.clear();
  uiDirCache.clear();
}

const uiDirCache = new Map<string, string>();

/**
 * Directory of the project's shadcn primitives (`aliases.ui` in components.json, default `components/ui`).
 * Primitives are where raw elements are legitimately wrapped, so element-level rules skip them.
 */
export function primitivesDir(root: string): string {
  let dir = uiDirCache.get(root);
  if (dir === undefined) {
    dir = "components/ui";
    const file = path.join(root, "components.json");
    if (existsSync(file)) {
      try {
        const alias = (JSON.parse(readFileSync(file, "utf8")) as { aliases?: { ui?: string } }).aliases?.ui;
        if (alias) dir = alias.replace(/^[@~#]\//, "").replace(/\/$/, "");
      } catch {
        // keep default
      }
    }
    uiDirCache.set(root, dir);
  }
  return dir;
}

export interface ActiveRule {
  rule: ResolvedRule;
  relPath: string;
}

/**
 * Returns the contract rule if it applies to the file being linted, otherwise null.
 * Locked components and shadcn primitives are exempt: that is where the sanctioned implementation lives.
 */
export function activeContractRule(context: Rule.RuleContext, contractRuleId: string): ActiveRule | null | { error: string } {
  const root = projectRoot(context);
  const loaded = loadResolved(root);
  if (!loaded.ok) return { error: loaded.error };
  const rule = getRule(loaded.resolved, contractRuleId);
  if (!rule) return null;
  const relPath = path.relative(root, context.filename).split(path.sep).join("/");
  if (relPath.startsWith(`${COMPONENTS_DIR}/`) || relPath.startsWith(`${primitivesDir(root)}/`)) return null;
  if (!ruleAppliesTo(rule, relPath, loaded.resolved.scopes)) return null;
  return { rule, relPath };
}

export function citation(rule: ResolvedRule): string {
  const params = Object.entries(rule.params)
    .map(([k, v]) => `${k} = ${String(v)}`)
    .join(", ");
  return `Rule ${rule.id}${params ? ` (${params})` : ""} — ${rule.origin}`;
}
