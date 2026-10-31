import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DESIGN_DIR } from "@frontend-consistency/core";

export const DEFAULT_REGISTRY = "https://raw.githubusercontent.com/dangnhit/frontend-consistency/main/registry/public/r/{name}.json";
export const PRESET = "@frontend-consistency/preset-baseline";
const HOOK_MATCHER = "Edit|Write|MultiEdit";

export interface InitOptions {
  registry?: string;
  /** Force-enable agent integrations even if not detected. */
  claude?: boolean;
}

export interface InitReport {
  done: string[];
  todo: string[];
}

function writeIfMissing(file: string, content: string, report: InitReport, root: string): void {
  if (existsSync(file)) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  report.done.push(`created ${path.relative(root, file)}`);
}

function setupContract(root: string, report: InitReport): void {
  const dir = path.join(root, DESIGN_DIR);
  writeIfMissing(
    path.join(dir, "contract.yaml"),
    [
      `extends: "${PRESET}"`,
      "",
      "# Named path groups that rules can target with `scope:`.",
      "scopes: {}",
      "",
      "# Project-wide values referenced by rules and components.",
      "params: {}",
      "",
      "# Per-rule changes: severity, scope, params, exceptions. Record the reason in decisions/.",
      "overrides: {}",
      "",
    ].join("\n"),
    report,
    root,
  );
  writeIfMissing(path.join(dir, "rules", ".gitkeep"), "", report, root);
  writeIfMissing(
    path.join(dir, "decisions", "README.md"),
    "# Design decisions\n\nOne file per decision (`0001-short-title.md`): context, decision, rules affected.\nNot loaded into agent context — history lives here, active rules live in `rules/` and `contract.yaml`.\n",
    report,
    root,
  );
}

function setupRegistry(root: string, registry: string, report: InitReport): void {
  const file = path.join(root, "components.json");
  if (!existsSync(file)) {
    report.todo.push("components.json not found — run `npx shadcn init` first, then re-run `fcs init`.");
    return;
  }
  const json = JSON.parse(readFileSync(file, "utf8")) as { registries?: Record<string, unknown> };
  if (json.registries?.["@fcs"]) return;
  json.registries = { ...json.registries, "@fcs": registry };
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  report.done.push("added @fcs registry to components.json");
}

const ESLINT_FILES = ["eslint.config.mjs", "eslint.config.js", "eslint.config.ts"];

function setupEslint(root: string, report: InitReport): void {
  const snippet = 'import fcs from "@frontend-consistency/eslint-plugin";\n// ...\nexport default [...yourConfig, ...fcs.config()];';
  const name = ESLINT_FILES.find((f) => existsSync(path.join(root, f)));
  if (!name) {
    report.todo.push(`No flat ESLint config found. Add:\n${snippet}`);
    return;
  }
  const file = path.join(root, name);
  const src = readFileSync(file, "utf8");
  if (src.includes("@frontend-consistency/eslint-plugin")) return;
  const m = /export default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m.exec(src);
  if (!m) {
    report.todo.push(`Could not edit ${name} automatically. Add:\n${snippet}`);
    return;
  }
  const next =
    `import fcs from "@frontend-consistency/eslint-plugin";\n` +
    src.replace(m[0], `const withFcs = [...${m[1]}, ...fcs.config()];\n\nexport default withFcs;\n`);
  writeFileSync(file, next);
  report.done.push(`added fcs.config() to ${name}`);
}

type HookEntry = { matcher?: string; hooks: { type: string; command: string }[] };

function setupClaude(root: string, report: InitReport): void {
  const file = path.join(root, ".claude", "settings.json");
  const settings = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as { hooks?: Record<string, HookEntry[]> })
    : {};
  settings.hooks ??= {};
  const bin = '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/fcs';
  let changed = false;
  for (const [event, sub] of [
    ["PreToolUse", "pre"],
    ["PostToolUse", "post"],
  ] as const) {
    const command = `${bin} hook ${sub}`;
    const list = (settings.hooks[event] ??= []);
    if (list.some((e) => e.hooks.some((h) => h.command === command))) continue;
    list.push({ matcher: HOOK_MATCHER, hooks: [{ type: "command", command }] });
    changed = true;
  }
  if (!changed) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  report.done.push("installed Claude Code hooks in .claude/settings.json (block locked files, lint after each edit)");
}

const PACKAGES = ["@frontend-consistency/cli", "@frontend-consistency/eslint-plugin", PRESET];

function missingPackages(root: string): string[] {
  const file = path.join(root, "package.json");
  if (!existsSync(file)) return PACKAGES;
  const pkg = JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, string> | undefined>;
  const has = { ...pkg.dependencies, ...pkg.devDependencies };
  return PACKAGES.filter((p) => !has[p]);
}

export function init(root: string, opts: InitOptions = {}): InitReport {
  const report: InitReport = { done: [], todo: [] };
  setupContract(root, report);
  setupRegistry(root, opts.registry ?? DEFAULT_REGISTRY, report);
  setupEslint(root, report);

  const hasClaude = opts.claude || existsSync(path.join(root, ".claude")) || existsSync(path.join(root, "CLAUDE.md"));
  if (hasClaude) setupClaude(root, report);
  else report.todo.push("Claude Code not detected — run `fcs init --claude` to install its hooks.");
  if (existsSync(path.join(root, ".cursor"))) {
    report.todo.push("Cursor detected: rules are generated to .cursor/rules/fcs.mdc; Cursor hooks cannot feed lint back, rely on pre-commit `fcs check`.");
  }
  const missing = missingPackages(root);
  if (missing.length) report.todo.push(`Install dev dependencies: ${missing.join(" ")}`);
  report.todo.push("Add `fcs check` to pre-commit and CI.");
  return report;
}
