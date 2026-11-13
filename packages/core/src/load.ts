import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { z } from "zod";
import { ContractSchema, RuleFileSchema, type Contract, type Pattern, type Rule, type ScopeDef } from "./schema.js";

export const DESIGN_DIR = ".design";

export interface Issue {
  file: string;
  message: string;
}

export class ContractError extends Error {
  constructor(public readonly issues: Issue[]) {
    super(`Invalid design contract:\n${issues.map((i) => `  ${i.file}: ${i.message}`).join("\n")}`);
    this.name = "ContractError";
  }
}

export interface SourcedRule {
  rule: Rule;
  file: string;
  /** Display path for citations; defaults to `file` relative to the project root. */
  label?: string;
}

export interface RuleLayer {
  /** Human label, e.g. package name or "project". */
  name: string;
  rules: SourcedRule[];
}

/** Patterns declared by one contract file; globs and scopes are relative to `root`. */
export interface PatternLayer {
  root: string;
  contractFile: string;
  /** 0 for the outermost parent, increasing towards the project being loaded. */
  depth: number;
  scopes: Record<string, ScopeDef>;
  patterns: Record<string, Pattern>;
}

export interface LoadedContract {
  root: string;
  contract: Contract;
  contractFile: string;
  /** Ordered lowest-precedence first: parent contracts, presets (in `extends` order), then project rules. */
  layers: RuleLayer[];
  /** Ordered parent-first; the last entry is this project's contract. */
  patternLayers: PatternLayer[];
}

function formatZod(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`).join("; ");
}

function readYaml(file: string, issues: Issue[]): unknown {
  try {
    return parseYaml(readFileSync(file, "utf8"));
  } catch (e) {
    issues.push({ file, message: `YAML parse error: ${(e as Error).message}` });
    return undefined;
  }
}

function loadRulesDir(dir: string, issues: Issue[], labelPrefix?: string): SourcedRule[] {
  if (!existsSync(dir)) return [];
  const out: SourcedRule[] = [];
  for (const name of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const file = path.join(dir, name);
    const raw = readYaml(file, issues);
    if (raw === undefined || raw === null) continue;
    const parsed = RuleFileSchema.safeParse(raw);
    if (!parsed.success) {
      issues.push({ file, message: formatZod(parsed.error) });
      continue;
    }
    const label = labelPrefix ? `${labelPrefix}/rules/${name}` : undefined;
    for (const rule of parsed.data) out.push({ rule, file, ...(label && { label }) });
  }
  return out;
}

/**
 * Resolve an `extends` entry to a directory containing `rules/*.yaml`.
 * Accepts a relative path (from the contract file) or a package name resolvable from the project root.
 */
export function resolvePresetDir(entry: string, root: string): string {
  if (entry.startsWith(".") || path.isAbsolute(entry)) {
    return path.resolve(root, DESIGN_DIR, entry);
  }
  const require = createRequire(path.join(root, "package.json"));
  try {
    return path.dirname(require.resolve(`${entry}/package.json`));
  } catch {
    // `exports` may hide package.json — resolve the main entry and walk up to the package root.
    let dir = path.dirname(require.resolve(entry));
    while (dir !== path.dirname(dir)) {
      const pkg = path.join(dir, "package.json");
      if (existsSync(pkg) && JSON.parse(readFileSync(pkg, "utf8")).name === entry) return dir;
      dir = path.dirname(dir);
    }
    throw new Error(`cannot locate package root for ${entry}`);
  }
}

/**
 * A parent contract: an `extends` entry that points at a `.design/` directory (or a project root containing one).
 * Returns the parent project root, or null when `dir` is a rules preset.
 */
function parentRootOf(dir: string): string | null {
  if (existsSync(path.join(dir, "contract.yaml"))) return path.dirname(dir);
  if (existsSync(path.join(dir, DESIGN_DIR, "contract.yaml"))) return dir;
  return null;
}

export function loadContract(root: string, visiting: string[] = []): LoadedContract {
  const issues: Issue[] = [];
  const designDir = path.join(root, DESIGN_DIR);
  const contractFile = path.join(designDir, "contract.yaml");

  let contract: Contract = ContractSchema.parse({});
  if (existsSync(contractFile)) {
    const raw = readYaml(contractFile, issues) ?? {};
    const parsed = ContractSchema.safeParse(raw);
    if (parsed.success) contract = parsed.data;
    else issues.push({ file: contractFile, message: formatZod(parsed.error) });
  } else {
    issues.push({ file: contractFile, message: "missing (run `fcs init`)" });
  }

  const layers: RuleLayer[] = [];
  const parentPatterns: PatternLayer[] = [];
  for (const entry of contract.extends) {
    let dir: string;
    try {
      dir = resolvePresetDir(entry, root);
    } catch {
      issues.push({ file: contractFile, message: `cannot resolve extends "${entry}" — is it installed?` });
      continue;
    }
    const parentRoot = parentRootOf(dir);
    if (parentRoot) {
      const chain = [...visiting, path.resolve(root)];
      if (chain.includes(path.resolve(parentRoot))) {
        issues.push({ file: contractFile, message: `extends "${entry}" creates a cycle` });
        continue;
      }
      try {
        const parent = loadContract(parentRoot, chain);
        layers.push(...parent.layers);
        parentPatterns.push(...parent.patternLayers);
      } catch (e) {
        if (e instanceof ContractError) issues.push(...e.issues);
        else throw e;
      }
      continue;
    }
    const isPackage = !(entry.startsWith(".") || path.isAbsolute(entry));
    layers.push({ name: entry, rules: loadRulesDir(path.join(dir, "rules"), issues, isPackage ? entry : undefined) });
  }
  layers.push({ name: "project", rules: loadRulesDir(path.join(designDir, "rules"), issues) });

  if (issues.length) throw new ContractError(issues);
  const depth = parentPatterns.reduce((d, l) => Math.max(d, l.depth + 1), 0);
  const patternLayers = [
    ...parentPatterns,
    { root: path.resolve(root), contractFile, depth, scopes: contract.scopes, patterns: contract.patterns },
  ];
  return { root, contract, contractFile, layers, patternLayers };
}
