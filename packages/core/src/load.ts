import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { z } from "zod";
import { ContractSchema, RuleFileSchema, type Contract, type Rule } from "./schema.js";

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
}

export interface RuleLayer {
  /** Human label, e.g. package name or "project". */
  name: string;
  rules: SourcedRule[];
}

export interface LoadedContract {
  root: string;
  contract: Contract;
  contractFile: string;
  /** Ordered lowest-precedence first: presets (in `extends` order), then project rules. */
  layers: RuleLayer[];
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

function loadRulesDir(dir: string, issues: Issue[]): SourcedRule[] {
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
    for (const rule of parsed.data) out.push({ rule, file });
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
  return path.dirname(require.resolve(`${entry}/package.json`));
}

export function loadContract(root: string): LoadedContract {
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
  for (const entry of contract.extends) {
    let dir: string;
    try {
      dir = resolvePresetDir(entry, root);
    } catch {
      issues.push({ file: contractFile, message: `cannot resolve extends "${entry}" — is it installed?` });
      continue;
    }
    layers.push({ name: entry, rules: loadRulesDir(path.join(dir, "rules"), issues) });
  }
  layers.push({ name: "project", rules: loadRulesDir(path.join(designDir, "rules"), issues) });

  if (issues.length) throw new ContractError(issues);
  return { root, contract, contractFile, layers };
}
