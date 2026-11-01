import path from "node:path";
import type { ESLint, Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { loadResolved } from "./contract.js";
import { noAdHocLoading } from "./rules/no-ad-hoc-loading.js";
import { noDisable } from "./rules/no-disable.js";
import { noRawTextarea } from "./rules/no-raw-textarea.js";

export { clearContractCache } from "./contract.js";

export const rules = {
  "no-raw-textarea": noRawTextarea,
  "no-ad-hoc-loading": noAdHocLoading,
  "no-disable": noDisable,
};

const plugin: ESLint.Plugin & { configs: Record<string, Linter.Config[]> } = {
  meta: { name: "@frontend-consistency/eslint-plugin" },
  rules,
  configs: {},
};

const RANK = { off: 0, warn: 1, error: 2 } as const;

export interface FcsConfigOptions {
  /** Project root containing `.design/` (default: process.cwd()). */
  root?: string;
  /** Files to lint (default: JS/TS sources). */
  files?: string[];
}

/**
 * Flat config whose severities come from the design contract — rules are configured once, in `.design/`.
 *
 *   import fcs from "@frontend-consistency/eslint-plugin";
 *   export default [...nextConfig, ...fcs.config()];
 */
export function config(opts: FcsConfigOptions = {}): Linter.Config[] {
  const root = path.resolve(opts.root ?? process.cwd());
  const severity: Record<string, Linter.RuleSeverity> = Object.fromEntries(
    Object.keys(rules).map((r) => [`fcs/${r}`, "error" as const]),
  );

  const loaded = loadResolved(root);
  if (loaded.ok) {
    const fromContract: Record<string, keyof typeof RANK> = {};
    for (const rule of loaded.resolved.rules) {
      for (const lint of rule.enforce?.lint ?? []) {
        const prev = fromContract[lint];
        if (!prev || RANK[rule.severity] > RANK[prev]) fromContract[lint] = rule.severity;
      }
    }
    for (const [lint, sev] of Object.entries(fromContract)) if (lint in severity) severity[lint] = sev;
  }
  // Otherwise keep rules on: they report the contract load error in-file instead of silently passing.

  return [
    {
      name: "fcs/contract",
      files: opts.files ?? ["**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}"],
      plugins: { fcs: plugin },
      languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
      settings: { fcs: { root } },
      rules: severity,
    },
  ];
}

Object.defineProperty(plugin.configs, "recommended", { enumerable: true, get: () => config() });

const fcs: ESLint.Plugin & { configs: Record<string, Linter.Config[]>; config: typeof config } = Object.assign(plugin, {
  config,
});
export default fcs;
