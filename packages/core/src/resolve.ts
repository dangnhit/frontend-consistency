import path from "node:path";
import picomatch from "picomatch";
import { ContractError, type Issue, type LoadedContract } from "./load.js";
import type { ParamValue, Rule, RulePatch, ScopeDef } from "./schema.js";

export interface ResolvedRule extends Rule {
  /** File the rule was (last) defined or patched in, relative to project root. */
  origin: string;
}

export interface ResolvedContract {
  version: 1;
  scopes: Record<string, ScopeDef>;
  params: Record<string, ParamValue>;
  rules: ResolvedRule[];
}

function applyPatch(rule: ResolvedRule, patch: RulePatch, origin: string): ResolvedRule {
  return {
    ...rule,
    ...(patch.severity !== undefined && { severity: patch.severity }),
    ...(patch.scope !== undefined && { scope: patch.scope }),
    ...(patch.params !== undefined && { params: { ...rule.params, ...patch.params } }),
    ...(patch.exceptions !== undefined && { exceptions: patch.exceptions }),
    origin,
  };
}

/**
 * Merge presets → project rules → contract overrides. Later layers win, field-merged.
 * Within a single layer, duplicate ids are an error.
 */
export function resolveContract(loaded: LoadedContract): ResolvedContract {
  const { root, contract, contractFile, layers } = loaded;
  const rel = (f: string) => path.relative(root, f);
  const issues: Issue[] = [];
  const byId = new Map<string, ResolvedRule>();

  for (const layer of layers) {
    const seen = new Map<string, string>();
    for (const { rule, file, label } of layer.rules) {
      const origin = label ?? rel(file);
      const prev = seen.get(rule.id);
      if (prev) {
        issues.push({ file, message: `duplicate rule id "${rule.id}" (also in ${rel(prev)})` });
        continue;
      }
      seen.set(rule.id, file);
      const existing = byId.get(rule.id);
      if (existing) {
        // Redefinition in a later layer: full fields replace, params merge.
        byId.set(rule.id, { ...existing, ...rule, params: { ...existing.params, ...rule.params }, origin });
      } else {
        byId.set(rule.id, { ...rule, origin });
      }
    }
  }

  for (const [id, patch] of Object.entries(contract.overrides)) {
    const rule = byId.get(id);
    if (!rule) {
      issues.push({ file: contractFile, message: `override targets unknown rule "${id}"` });
      continue;
    }
    byId.set(id, applyPatch(rule, patch, rel(contractFile)));
  }

  const rules = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));

  for (const rule of rules) {
    for (const s of rule.scope ?? []) {
      if (!contract.scopes[s]) {
        issues.push({ file: rule.origin, message: `rule "${rule.id}" uses undefined scope "${s}"` });
      }
    }
    for (const sup of rule.supersedes) {
      const target = byId.get(sup);
      if (rule.severity !== "off" && target && target.severity !== "off") {
        issues.push({
          file: rule.origin,
          message: `rule "${rule.id}" supersedes "${sup}", but "${sup}" is still active — set it to off or remove it`,
        });
      }
    }
  }

  if (issues.length) throw new ContractError(issues);
  return { version: 1, scopes: contract.scopes, params: contract.params, rules };
}

/**
 * Compile globs. Parentheses are matched literally: Next.js route groups like `app/(app)/**`
 * are far more common in this domain than regex groups. Use `{a,b}` for alternation.
 */
export function compileGlobs(globs: string[]): (p: string) => boolean {
  if (!globs.length) return () => false;
  const escaped = globs.map((g) => g.replace(/(?<!\\)([()])/g, "\\$1"));
  return picomatch(escaped, { dot: true });
}

/**
 * Whether `rule` applies to `relPath` (POSIX path relative to project root):
 * not off, inside one of its scopes (or unscoped), and not covered by an exception.
 */
export function ruleAppliesTo(rule: Rule, relPath: string, scopes: Record<string, ScopeDef>): boolean {
  if (rule.severity === "off") return false;
  const p = relPath.split(path.sep).join("/");
  if (rule.scope?.length) {
    const inScope = rule.scope.some((name) => {
      const def = scopes[name];
      return def ? compileGlobs(def.include)(p) && !compileGlobs(def.exclude)(p) : false;
    });
    if (!inScope) return false;
  }
  return !rule.exceptions.some((e) => compileGlobs([e.path])(p));
}

export function getRule(resolved: ResolvedContract, id: string): ResolvedRule | undefined {
  return resolved.rules.find((r) => r.id === id);
}
