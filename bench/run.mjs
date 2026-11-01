#!/usr/bin/env node
// Benchmark: does frontend-consistency reduce UI drift in agent-generated code? (decision D11)
//
//   node bench/run.mjs [--tasks notes-form] [--variants none,design-md,fcs] [--runs 3] [--model sonnet] [--score-only <dir>]
//
// Each (task, variant, run) gets a fresh copy of bench/fixture under bench/.runs/<stamp>/, prepared for the variant,
// then Claude Code runs headless with only project settings (no user plugins/hooks/MCP). Every result is scored
// against the fixture's contract with the same deterministic checks, regardless of variant.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const BENCH = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(BENCH, "fixture");
const FCS = path.join(FIXTURE, "node_modules/.bin/fcs");

const { values } = parseArgs({
  options: {
    tasks: { type: "string" },
    variants: { type: "string", default: "none,design-md,fcs" },
    runs: { type: "string", default: "3" },
    model: { type: "string", default: "sonnet" },
    "score-only": { type: "string" },
  },
});

const ALL_TASKS = readdirSync(path.join(BENCH, "tasks"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => f.slice(0, -3));
const tasks = values.tasks ? values.tasks.split(",") : ALL_TASKS;
const variants = values.variants.split(",");
const runs = Number(values.runs);

/** Prose rules a team would typically write in DESIGN.md — same content as the contract, no enforcement. */
const DESIGN_MD_PROSE = `# Design rules

- Textareas must not be user-resizable (no resize handle). Use a fixed number of rows.
- Every form field has a visible label; placeholders are not labels.
- Page and section loading states use skeletons shaped like the content. No spinners except inside buttons
  (in-flight action), no "Loading..." text.
`;

const COPY_SKIP = new Set(["node_modules", ".next", ".turbo", "tsconfig.tsbuildinfo"]);

function prepare(dir, variant) {
  cpSync(FIXTURE, dir, { recursive: true, filter: (src) => !COPY_SKIP.has(path.basename(src)) });
  // Nested pnpm symlinks resolve relative to the real fixture/node_modules, so one link is enough.
  symlinkSync(path.join(FIXTURE, "node_modules"), path.join(dir, "node_modules"));
  if (variant === "fcs") return;

  // Strip every trace of fcs: contract, locked components, hooks, generated blocks, lint wiring.
  for (const p of [".design", "components/fcs", ".claude", "CLAUDE.md", "DESIGN.md"]) rmSync(path.join(dir, p), { recursive: true, force: true });
  const agents = path.join(dir, "AGENTS.md");
  writeFileSync(agents, readFileSync(agents, "utf8").replace(/\n*<!-- fcs:start -->[\s\S]*<!-- fcs:end -->\n?/, "\n"));
  const eslint = path.join(dir, "eslint.config.mjs");
  writeFileSync(
    eslint,
    readFileSync(eslint, "utf8")
      .replace('import fcs from "@frontend-consistency/eslint-plugin";\n', "")
      .replace(/const withFcs = \[\.\.\.(\w+), \.\.\.fcs\.config\(\)\];\n\nexport default withFcs;/, "export default $1;"),
  );
  const components = path.join(dir, "components.json");
  const cj = JSON.parse(readFileSync(components, "utf8"));
  delete cj.registries?.["@fcs"];
  writeFileSync(components, `${JSON.stringify(cj, null, 2)}\n`);
  if (variant === "design-md") {
    writeFileSync(path.join(dir, "DESIGN.md"), DESIGN_MD_PROSE);
    writeFileSync(path.join(dir, "CLAUDE.md"), "Follow the UI rules in DESIGN.md for all UI work.\n");
  }
}

function runAgent(dir, prompt, session = 0) {
  const started = Date.now();
  const res = spawnSync(
    "claude",
    [
      "-p",
      prompt,
      "--model",
      values.model,
      "--setting-sources",
      "project",
      "--strict-mcp-config",
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      "Read,Write,Edit,MultiEdit,Glob,Grep,Bash(npx fcs check*),Bash(ls*)",
      "--output-format",
      "json",
    ],
    { cwd: dir, encoding: "utf8", timeout: 15 * 60_000, env: { ...process.env, CLAUDE_PROJECT_DIR: dir } },
  );
  let meta = {};
  try {
    meta = JSON.parse(res.stdout);
  } catch {
    meta = { error: (res.stderr || res.stdout || "").slice(0, 500) };
  }
  writeFileSync(path.join(dir, `.bench-agent${session ? `-${session + 1}` : ""}.json`), JSON.stringify(meta, null, 2));
  return { seconds: Math.round((Date.now() - started) / 1000), cost: meta.total_cost_usd ?? null, ok: res.status === 0 };
}

const SESSION_SPLIT = /^---\s*session\s*---$/m;
const SNAPSHOT_SKIP = new Set(["node_modules", ".next", ".design", ".claude", "public"]);

/** Hash of every app source file the agent may write (excludes locked components and shadcn primitives). */
function snapshot(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (SNAPSHOT_SKIP.has(e.name)) continue;
      const abs = path.join(d, e.name);
      const rel = path.relative(dir, abs);
      if (e.isDirectory()) {
        if (rel === path.join("components", "ui") || rel === path.join("components", "fcs")) continue;
        walk(abs);
      } else if (/\.(t|j)sx?$/.test(e.name)) {
        out.set(rel, createHash("sha1").update(readFileSync(abs)).digest("hex"));
      }
    }
  };
  walk(dir);
  return out;
}

/** Loading patterns present in a set of files. */
function loadingPatterns(dir, files) {
  const src = files.map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");
  const found = new Set();
  if (/<(PageSkeleton|AsyncBoundary)\b/.test(src)) found.add("fcs");
  if (/<Skeleton\b/.test(src)) found.add("skeleton");
  if (/animate-spin|<Loader(2|Circle)?\b|<Spinner\b/.test(src)) found.add("spinner");
  if (/>\s*Loading\s*(\.\.\.|…)?\s*</i.test(src) || /["'`]Loading\s*(\.\.\.|…)?["'`]/i.test(src)) found.add("text");
  return [...found].sort();
}

/** Score with the fixture contract, whatever the variant saw. */
function score(dir) {
  if (!existsSync(path.join(dir, ".design"))) cpSync(path.join(FIXTURE, ".design"), path.join(dir, ".design"), { recursive: true });
  const appFiles = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (/\.(t|j)sx?$/.test(e.name)) appFiles.push(path.relative(dir, abs));
    }
  };
  walk(path.join(dir, "app"));
  const lint = spawnSync(FCS, ["check", ...appFiles, "--format", "pretty", "--root", dir], { cwd: dir, encoding: "utf8" });
  const out = `${lint.stdout}\n${lint.stderr}`;
  const byRule = {};
  for (const m of out.matchAll(/ (?:error|warning) {2}(fcs\/[\w-]+):/g)) byRule[m[1]] = (byRule[m[1]] ?? 0) + 1;
  const src = appFiles.map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");
  // User-visible outcome, independent of how it was achieved: a textarea (raw or shadcn primitive) without
  // resize-none still shows a resize handle. TextareaField takes resize from the contract.
  const resizable = [...src.matchAll(/<(textarea|Textarea)\b[^>]*>/g)].filter((m) => !/\bresize-none\b/.test(m[0])).length;
  return {
    violations: Object.values(byRule).reduce((a, b) => a + b, 0),
    resizable,
    byRule,
    rawTextarea: (src.match(/<textarea\b/g) ?? []).length,
    usesTextareaField: /<TextareaField\b/.test(src),
    changedFiles: appFiles.filter((f) => f !== path.join("app", "page.tsx") && f !== path.join("app", "layout.tsx")).length,
  };
}

function table(rows) {
  const head =
    "| task | variant | run | contract violations | loading per session | consistent | resizable textareas | raw `<textarea>` | uses TextareaField | files | seconds | cost $ |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|---|---|";
  const lines = rows.map(
    (r) =>
      `| ${r.task} | ${r.variant} | ${r.run} | ${r.violations} | ${r.loading ?? "-"} | ${r.consistent == null ? "-" : r.consistent ? "yes" : "no"} | ${r.resizable} | ${r.rawTextarea} | ${r.usesTextareaField ? "yes" : "no"} | ${r.changedFiles} | ${r.seconds ?? "-"} | ${r.cost?.toFixed?.(3) ?? "-"} |`,
  );
  const summary = [];
  for (const task of new Set(rows.map((r) => r.task))) {
    for (const variant of new Set(rows.map((r) => r.variant))) {
      const g = rows.filter((r) => r.task === task && r.variant === variant);
      if (!g.length) continue;
      const clean = g.filter((r) => r.violations === 0).length;
      const avg = (k) => (g.reduce((a, r) => a + r[k], 0) / g.length).toFixed(1);
      const multi = g.filter((r) => r.consistent != null);
      const cons = multi.length ? `${multi.filter((r) => r.consistent).length}/${multi.length}` : "-";
      summary.push(`| ${task} | ${variant} | ${clean}/${g.length} | ${avg("violations")} | ${cons} | ${avg("resizable")} |`);
    }
  }
  return [
    "## Summary",
    "",
    "| task | variant | clean runs | avg contract violations | consistent across sessions | avg resizable textareas |",
    "|---|---|---|---|---|---|",
    ...summary,
    "",
    "Contract violations = `fcs check` findings (convention: use the locked component). Resizable textareas = what",
    "the user would see (a resize handle), however the code got there. Loading per session = patterns in the files each",
    "agent session wrote (fcs = PageSkeleton/AsyncBoundary); consistent = every session used exactly the same one.",
    "",
    "## Runs",
    "",
    head,
    sep,
    ...lines,
  ].join("\n");
}

const rows = [];
if (values["score-only"]) {
  const base = path.resolve(values["score-only"]);
  for (const name of readdirSync(base)) {
    const [task, variant, run] = name.split("__");
    if (!run) continue;
    rows.push({ task, variant, run, ...score(path.join(base, name)) });
  }
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(BENCH, ".runs", stamp);
  mkdirSync(base, { recursive: true });
  for (const task of tasks) {
    const prompt = readFileSync(path.join(BENCH, "tasks", `${task}.md`), "utf8");
    for (const variant of variants) {
      for (let run = 1; run <= runs; run++) {
        const dir = path.join(base, `${task}__${variant}__${run}`);
        prepare(dir, variant);
        process.stdout.write(`▶ ${task} / ${variant} / run ${run} … `);
        const sessions = prompt.split(SESSION_SPLIT).map((p) => p.trim()).filter(Boolean);
        const agent = { seconds: 0, cost: 0, ok: true };
        const perSession = [];
        for (const [i, p] of sessions.entries()) {
          const before = snapshot(dir);
          const r = runAgent(dir, p, i);
          agent.seconds += r.seconds;
          agent.cost = r.cost == null || agent.cost == null ? null : agent.cost + r.cost;
          agent.ok &&= r.ok;
          const after = snapshot(dir);
          const touched = [...after.keys()].filter((f) => before.get(f) !== after.get(f));
          perSession.push(loadingPatterns(dir, touched));
        }
        const s = score(dir);
        const loading = perSession.map((p) => p.join("+") || "none").join(" / ");
        const consistent = sessions.length > 1 ? perSession.every((p) => p.length === 1 && p[0] === perSession[0][0]) : null;
        console.log(`${s.violations} violation(s), loading ${loading}, ${agent.seconds}s${agent.ok ? "" : " (agent exited non-zero)"}`);
        rows.push({ task, variant, run, ...agent, ...s, loading, consistent });
      }
    }
  }
  console.log(`\nRun dirs: ${base}`);
}

const report = `# Bench results — ${new Date().toISOString().slice(0, 10)}\n\nModel: ${values.model}\n\n${table(rows)}\n`;
mkdirSync(path.join(BENCH, "results"), { recursive: true });
const out = path.join(BENCH, "results", `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.md`);
writeFileSync(out, report);
console.log(report);
console.log(`Saved ${path.relative(process.cwd(), out)}`);
