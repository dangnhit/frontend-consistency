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
} from "@frontend-consistency/core";

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
}

export interface ActiveRule {
  rule: ResolvedRule;
  relPath: string;
}

/**
 * Returns the contract rule if it applies to the file being linted, otherwise null.
 * Files inside the locked components dir are always exempt: that is where the sanctioned implementation lives.
 */
export function activeContractRule(context: Rule.RuleContext, contractRuleId: string): ActiveRule | null | { error: string } {
  const root = projectRoot(context);
  const loaded = loadResolved(root);
  if (!loaded.ok) return { error: loaded.error };
  const rule = getRule(loaded.resolved, contractRuleId);
  if (!rule) return null;
  const relPath = path.relative(root, context.filename).split(path.sep).join("/");
  if (relPath.startsWith(`${COMPONENTS_DIR}/`)) return null;
  if (!ruleAppliesTo(rule, relPath, loaded.resolved.scopes)) return null;
  return { rule, relPath };
}

export function citation(rule: ResolvedRule): string {
  const params = Object.entries(rule.params)
    .map(([k, v]) => `${k} = ${String(v)}`)
    .join(", ");
  return `Rule ${rule.id}${params ? ` (${params})` : ""} — ${rule.origin}`;
}
