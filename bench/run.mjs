#!/usr/bin/env node
// Benchmark: does frontend-consistency reduce UI drift in agent-generated code? (decision D11)
//
//   node bench/run.mjs [--tasks notes-form] [--variants none,design-md,fcs] [--runs 3] [--model sonnet] [--score-only <dir>]
//
// Each (task, variant, run) gets a fresh copy of bench/fixture under bench/.runs/<stamp>/, prepared for the variant,
// then Claude Code runs headless with only project settings (no user plugins/hooks/MCP). Every result is scored
// against the fixture's contract with the same deterministic checks, regardless of variant.
import { spawnSync } from "node:child_process";
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

// A task is tasks/<name>.md, or tasks/<name>/ with prompt.md and optionally:
//   seed/         copied over the project (existing screens the agent will see)
//   remove.txt    paths deleted in the none/design-md variants
//   contract.yaml the task's .design/contract.yaml: used by the fcs variant and for scoring every variant
//   design.md     prose rules for the design-md variant (same decisions as contract.yaml)
//   share-design-with-fcs  empty marker: the fcs variant also keeps design.md as its DESIGN.md prose (a team
//                 adopting fcs on top of an existing guidelines doc)
const ALL_TASKS = readdirSync(path.join(BENCH, "tasks"), { withFileTypes: true })
  .filter((e) => (e.isFile() && e.name.endsWith(".md")) || (e.isDirectory() && existsSync(path.join(BENCH, "tasks", e.name, "prompt.md"))))
  .map((e) => e.name.replace(/\.md$/, ""));
const tasks = values.tasks ? values.tasks.split(",") : ALL_TASKS;
const variants = values.variants.split(",");
const runs = Number(values.runs);

/** Prose rules a team would typically write in DESIGN.md — same content as the contract, no enforcement. */
const DESIGN_MD_PROSE = `# Design rules

- Textareas must not be user-resizable (no resize handle). Use a fixed number of rows.
- Every form field has a visible label; placeholders are not labels.
- Page and section loading states use skeletons shaped like the content. No spinners except inside buttons
  (in-flight action), no "Loading..." text.
- Every page uses the same frame: \`<main className="mx-auto flex w-full max-w-screen-xl flex-1 flex-col gap-6 px-4 py-6 md:px-6 md:py-8">\`
  with the page header first.
- The page title is \`<h1 className="text-2xl font-semibold tracking-tight">\`; page actions sit right-aligned in the header.
- Pages below a top-level section (e.g. /customers/[id]) show a breadcrumb (shadcn Breadcrumb) above the title
  instead of a back link; the last crumb is the current page.
`;

const COPY_SKIP = new Set(["node_modules", ".next", ".turbo", "tsconfig.tsbuildinfo"]);

function loadTask(task) {
  const folder = path.join(BENCH, "tasks", task);
  if (!existsSync(folder) || !readdirSync(folder).includes("prompt.md")) {
    return { prompt: readFileSync(`${folder}.md`, "utf8"), seed: null, remove: [], contract: null, design: null };
  }
  const opt = (f) => (existsSync(path.join(folder, f)) ? readFileSync(path.join(folder, f), "utf8") : null);
  const removeFile = path.join(folder, "remove.txt");
  return {
    prompt: readFileSync(path.join(folder, "prompt.md"), "utf8"),
    seed: existsSync(path.join(folder, "seed")) ? path.join(folder, "seed") : null,
    remove: existsSync(removeFile)
      ? readFileSync(removeFile, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
      : [],
    contract: opt("contract.yaml"),
    design: opt("design.md"),
    shareDesign: existsSync(path.join(folder, "share-design-with-fcs")),
  };
}

/** Bench bookkeeping lives next to the project copy, never inside it, so agents cannot read it. */
function metaDir(dir) {
  const m = `${dir}.meta`;
  mkdirSync(m, { recursive: true });
  return m;
}

function listFiles(root, base = root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(path.join(root, e.name), base) : [path.relative(base, path.join(root, e.name))],
  );
}

/** Make the copy a git repo with one baseline commit, like a real project (the Stop hook lints changed files). */
function gitBaseline(dir) {
  const git = (...a) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  writeFileSync(path.join(dir, ".git/info/exclude"), "node_modules\n");
  git("add", "-A");
  git("-c", "user.email=bench@example.invalid", "-c", "user.name=bench", "commit", "-qm", "baseline");
}

function prepare(dir, variant, taskDef = { seed: null, remove: [], contract: null, design: null }) {
  cpSync(FIXTURE, dir, { recursive: true, filter: (src) => !COPY_SKIP.has(path.basename(src)) });
  if (taskDef.seed) {
    cpSync(taskDef.seed, dir, { recursive: true });
    writeFileSync(path.join(metaDir(dir), "seed.json"), JSON.stringify(listFiles(taskDef.seed)));
  }
  if (variant !== "fcs") for (const p of taskDef.remove) rmSync(path.join(dir, p), { recursive: true, force: true });
  // Nested pnpm symlinks resolve relative to the real fixture/node_modules, so one link is enough.
  symlinkSync(path.join(FIXTURE, "node_modules"), path.join(dir, "node_modules"));
  if (taskDef.contract) {
    writeFileSync(path.join(metaDir(dir), "contract.yaml"), taskDef.contract);
    if (variant === "fcs") {
      writeFileSync(path.join(dir, ".design/contract.yaml"), taskDef.contract);
      spawnSync(FCS, ["build", "--root", dir], { cwd: dir, encoding: "utf8" });
    }
  }
  if (variant !== "fcs") stripFcs(dir, variant, taskDef.design);
  else if (taskDef.design && taskDef.shareDesign) {
    const designFile = path.join(dir, "DESIGN.md");
    writeFileSync(designFile, `${taskDef.design}\n${readFileSync(designFile, "utf8")}`);
    const claudeFile = path.join(dir, "CLAUDE.md");
    writeFileSync(claudeFile, `Follow the UI rules in DESIGN.md for all UI work.\n\n${readFileSync(claudeFile, "utf8")}`);
  }
  gitBaseline(dir);
}

function stripFcs(dir, variant, design) {

  // Strip every trace of fcs: contract, locked components, hooks, generated blocks, lint wiring.
  for (const p of [".design", "components/fcs", ".claude", "CLAUDE.md", "DESIGN.md"]) rmSync(path.join(dir, p), { recursive: true, force: true });
  // The fixture home page renders the locked <Page>; give other variants an unstyled equivalent.
  writeFileSync(
    path.join(dir, "app/page.tsx"),
    'export default function Home() {\n  return (\n    <main>\n      <h1>Dashboard</h1>\n      <p>Start here.</p>\n    </main>\n  );\n}\n',
  );
  const agents = path.join(dir, "AGENTS.md");
  writeFileSync(agents, readFileSync(agents, "utf8").replace(/\n*<!-- fcs:start -->[\s\S]*<!-- fcs:end -->\n?/, "\n"));
  const eslint = path.join(dir, "eslint.config.mjs");
  writeFileSync(
    eslint,
    readFileSync(eslint, "utf8")
      .replace('import fcs from "@gwinnguyen/eslint-plugin-fcs";\n', "")
      .replace(/const withFcs = \[\.\.\.(\w+), \.\.\.fcs\.config\(\)\];\n\nexport default withFcs;/, "export default $1;"),
  );
  const components = path.join(dir, "components.json");
  const cj = JSON.parse(readFileSync(components, "utf8"));
  delete cj.registries?.["@fcs"];
  writeFileSync(components, `${JSON.stringify(cj, null, 2)}\n`);
  if (variant === "design-md") {
    writeFileSync(path.join(dir, "DESIGN.md"), design ?? DESIGN_MD_PROSE);
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
  writeFileSync(path.join(metaDir(dir), `agent-${session + 1}.json`), JSON.stringify(meta, null, 2));
  return { seconds: Math.round((Date.now() - started) / 1000), cost: meta.total_cost_usd ?? null, ok: res.status === 0 };
}

const SESSION_SPLIT = /^---\s*session\s*---$/m;

function seeded(dir) {
  const legacy = path.join(dir, ".bench-seed.json"); // runs made before metadata moved out of the project copy
  const f = existsSync(legacy) ? legacy : path.join(`${dir}.meta`, "seed.json");
  return new Set(existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : []);
}
/**
 * Screens the agent added: every page.tsx under app/ except the fixture's own root page. A screen's loading pattern
 * comes from its page, its own loading.tsx, or the nearest ancestor loading.tsx (what Next actually renders),
 * plus local components the page imports via "@/components/..." (excluding shadcn primitives and locked fcs files).
 */
function screens(dir) {
  const pages = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (/^page\.(t|j)sx?$/.test(e.name)) pages.push(path.relative(dir, abs));
    }
  };
  walk(path.join(dir, "app"));
  return pages
    .filter((p) => path.dirname(p) !== "app" && !seeded(dir).has(p))
    .sort()
    .map((page) => {
      const files = [page];
      for (let d = path.dirname(page); d !== "."; d = path.dirname(d)) {
        const loading = ["loading.tsx", "loading.jsx"].map((f) => path.join(d, f)).find((f) => existsSync(path.join(dir, f)));
        if (loading) {
          files.push(loading);
          break;
        }
      }
      // Follow local imports ("@/components/...", "./x", "../x") from the page and its loading.tsx (one level).
      for (const from of [...files]) {
        for (const m of readFileSync(path.join(dir, from), "utf8").matchAll(/from\s+["'](@\/components\/[^"']+|\.{1,2}\/[^"']+)["']/g)) {
          const base = m[1].startsWith("@/") ? m[1].slice(2) : path.join(path.dirname(from), m[1]);
          if (/^components\/(ui|fcs)\//.test(base)) continue; // primitives: the JSX name already tells the pattern
          const f = [".tsx", ".ts", "/index.tsx"].map((x) => base + x).find((x) => existsSync(path.join(dir, x)));
          if (f && !files.includes(f)) files.push(f);
        }
      }
      const all = files.map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");
      const loadsData = /\bget[A-Z]\w*\(/.test(all);
      const route = path.dirname(page).replace(/^app/, "") || "/";
      const depth = route.split("/").filter((x) => x && !/^\(.*\)$/.test(x) && !x.startsWith("@")).length;
      return { route, depth, patterns: loadingPatterns(dir, files), loadsData, ...header(readFileSync(path.join(dir, page), "utf8"), all) };
    });
}

const LAYOUT_TOKEN = /^(?:[a-z0-9]+:)?(?:mx-auto|container|max-w-\S+|p[xytb]?-\S+|gap-\S+|space-y-\S+)$/;
const layoutSig = (cls) => (cls ?? "").split(/\s+/).filter((t) => LAYOUT_TOKEN.test(t)).sort().join(" ") || "(none)";

/**
 * How a screen frames itself. frame = layout classes of the page's root element (or "fcs" for a template);
 * title = classes on its <h1> (or "fcs"); breadcrumb = breadcrumb | back-link | none.
 */
function header(pageSrc, allSrc) {
  const template = /<(Page|ListPage)\b/.test(pageSrc);
  const root = /return\s*\(?\s*<(\w+)([^>]*)>/.exec(pageSrc);
  const rootCls = root && /className=["'{`]+([^"'`}]*)/.exec(root[2])?.[1];
  const h1 = /<h1\b[^>]*className=["'{`]+([^"'`}]*)/.exec(allSrc)?.[1];
  const breadcrumb = /breadcrumbs=|<Breadcrumb\b|aria-label=["']breadcrumb/i.test(allSrc)
    ? "breadcrumb"
    : /back to|←|ArrowLeft|ChevronLeft/i.test(allSrc)
      ? "back-link"
      : "none";
  return {
    frame: template ? "fcs" : layoutSig(rootCls),
    title: template ? "fcs" : h1 ? h1.split(/\s+/).sort().join(" ") : /<h1\b/.test(allSrc) ? "(unstyled)" : "(no h1)",
    breadcrumb,
  };
}

/** Loading patterns present in a set of files. */
function loadingPatterns(dir, files) {
  // Spinners inside buttons are in-flight actions, not loading states.
  const src = files
    .map((f) => readFileSync(path.join(dir, f), "utf8"))
    .join("\n")
    .replace(/<(Button|button|SubmitButton)\b[\s\S]*?<\/\1>/g, "")
    .replace(/<span[^>]*\bsr-only\b[^>]*>[\s\S]*?<\/span>/g, ""); // screen-reader labels are not visible text
  const found = new Set();
  if (/<(PageSkeleton|AsyncBoundary)\b/.test(src)) found.add("fcs");
  if (/<Skeleton\b|animate-pulse/.test(src)) found.add("skeleton");
  if (/animate-spin|<Loader(2|Circle)?\b|<\w*Spinner\b/.test(src)) found.add("spinner");
  if (/>\s*Loading\s*(\.\.\.|…)?\s*</i.test(src) || /\{\s*["'`]Loading\s*(\.\.\.|…)?["'`]\s*\}/i.test(src)) found.add("text");
  return [...found].sort();
}

/** Score with the fixture contract, whatever the variant saw. */
function score(dir) {
  if (!existsSync(path.join(dir, ".design"))) {
    cpSync(path.join(FIXTURE, ".design"), path.join(dir, ".design"), { recursive: true });
    const taskContract = path.join(`${dir}.meta`, "contract.yaml");
    if (existsSync(taskContract)) cpSync(taskContract, path.join(dir, ".design/contract.yaml"));
  }
  const pattern = /loading\.page:[^\n]*pattern:\s*(\w+)/.exec(readFileSync(path.join(dir, ".design/contract.yaml"), "utf8"))?.[1] ?? "skeleton";
  // Agent-written UI: app/** and components/** except shadcn primitives and locked fcs components.
  const appFiles = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      const rel = path.relative(dir, abs);
      if (e.isDirectory()) {
        if (rel === path.join("components", "ui") || rel === path.join("components", "fcs")) continue;
        walk(abs);
      } else if (/\.(t|j)sx?$/.test(e.name)) appFiles.push(rel);
    }
  };
  walk(path.join(dir, "app"));
  walk(path.join(dir, "components"));
  const seed = seeded(dir);
  const agentFiles = appFiles.filter((f) => !seed.has(f)); // seeded legacy screens are not the agent's work
  appFiles.length = 0;
  appFiles.push(...agentFiles);
  const lint = spawnSync(FCS, ["check", ...appFiles, "--format", "pretty", "--root", dir], { cwd: dir, encoding: "utf8" });
  const out = `${lint.stdout}\n${lint.stderr}`;
  const byRule = {};
  for (const m of out.matchAll(/ (?:error|warning) {2}(fcs\/[\w-]+):/g)) byRule[m[1]] = (byRule[m[1]] ?? 0) + 1;
  const src = appFiles.map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");
  // User-visible outcome, independent of how it was achieved: a textarea (raw or shadcn primitive) without
  // resize-none still shows a resize handle. TextareaField takes resize from the contract.
  // An agent may also fix the shadcn primitive itself (resize-none in components/ui/textarea.tsx).
  const primitive = path.join(dir, "components/ui/textarea.tsx");
  const primitiveFixed = existsSync(primitive) && /\bresize-none\b/.test(readFileSync(primitive, "utf8"));
  const resizable = [...src.matchAll(/<(textarea|Textarea)\b[^>]*>/g)].filter(
    (m) => !/\bresize-none\b/.test(m[0]) && !(m[1] === "Textarea" && primitiveFixed),
  ).length;
  const allScreens = screens(dir);
  const scr = allScreens.filter((x) => x.loadsData); // form-only screens have no loading state to judge
  const nested = allScreens.filter((x) => x.depth >= 2);
  const same = (k) => (allScreens.length > 1 ? allScreens.every((x) => x[k] === allScreens[0][k]) : null);
  return {
    violations: Object.values(byRule).reduce((a, b) => a + b, 0),
    loading: scr.map((x) => `${x.route}: ${x.patterns.join("+") || "none"}`).join(", "),
    consistent: scr.length > 1 ? scr.every((x) => x.patterns.length === 1 && x.patterns[0] === scr[0].patterns[0]) : null,
    // Visible outcome vs the project's decision: fcs components render the contract pattern by construction.
    followsLoading: scr.length ? scr.filter((x) => x.patterns.length === 1 && ["fcs", pattern].includes(x.patterns[0])).length : null,
    screens: scr.length,
    loadingRule: pattern,
    breadcrumbs: allScreens.map((x) => `${x.route}: ${x.breadcrumb}`).join(", "),
    nestedWithBreadcrumb: nested.length ? `${nested.filter((x) => x.breadcrumb === "breadcrumb").length}/${nested.length}` : "-",
    frameConsistent: same("frame"),
    titleConsistent: same("title"),
    frames: [...new Set(allScreens.map((x) => x.frame))].join(" | "),
    resizable,
    byRule,
    rawTextarea: (src.match(/<textarea\b/g) ?? []).length,
    usesTextareaField: /<TextareaField\b/.test(src),
    changedFiles: appFiles.filter((f) => f !== path.join("app", "page.tsx") && f !== path.join("app", "layout.tsx")).length,
  };
}

const yn = (v) => (v == null ? "-" : v ? "yes" : "no");

function table(rows) {
  const head =
    "| task | variant | run | contract violations | loading per screen | consistent | screens following loading rule | resizable textareas | raw `<textarea>` | uses TextareaField | nested with breadcrumb | breadcrumb per screen | same frame | same title style | frames | files | seconds | cost $ |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  const lines = rows.map(
    (r) =>
      `| ${r.task} | ${r.variant} | ${r.run} | ${r.violations} | ${r.loading ?? "-"} | ${r.consistent == null ? "-" : r.consistent ? "yes" : "no"} | ${r.followsLoading == null ? "-" : `${r.followsLoading}/${r.screens} (${r.loadingRule})`} | ${r.resizable} | ${r.rawTextarea} | ${r.usesTextareaField ? "yes" : "no"} | ${r.nestedWithBreadcrumb ?? "-"} | ${r.breadcrumbs || "-"} | ${yn(r.frameConsistent)} | ${yn(r.titleConsistent)} | ${r.frames ? `\`${r.frames}\`` : "-"} | ${r.changedFiles} | ${r.seconds ?? "-"} | ${r.cost?.toFixed?.(3) ?? "-"} |`,
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
      const fl = g.filter((r) => r.screens);
      const follows = fl.length ? `${fl.reduce((a, r) => a + r.followsLoading, 0)}/${fl.reduce((a, r) => a + r.screens, 0)}` : "-";
      const frac = (k) => {
        const h = g.filter((r) => r[k] != null);
        return h.length ? `${h.filter((r) => r[k]).length}/${h.length}` : "-";
      };
      const nb = g.map((r) => r.nestedWithBreadcrumb).filter((x) => x && x !== "-").map((x) => x.split("/").map(Number));
      const nbs = nb.length ? `${nb.reduce((a, [n]) => a + n, 0)}/${nb.reduce((a, [, d]) => a + d, 0)}` : "-";
      summary.push(`| ${task} | ${variant} | ${clean}/${g.length} | ${avg("violations")} | ${cons} | ${follows} | ${avg("resizable")} | ${nbs} | ${frac("frameConsistent")} | ${frac("titleConsistent")} |`);
    }
  }
  return [
    "## Summary",
    "",
    "| task | variant | clean runs | avg contract violations | consistent across screens | screens following loading rule | avg resizable textareas | nested screens with breadcrumb | same frame | same title style |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...summary,
    "",
    "Contract violations = `fcs check` findings (convention: use the locked component). Resizable textareas = what",
    "the user would see (a resize handle), however the code got there. Loading per screen = patterns in each new route's",
    "page, effective loading.tsx and imported local components (fcs = PageSkeleton/AsyncBoundary); consistent = every",
    "screen uses exactly the same single pattern. Header: frame = layout classes on the page's root element, title",
    "style = classes on its <h1> (fcs = rendered by the locked template); same = identical across every new screen.",
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
    if (!run || name.endsWith(".meta")) continue;
    rows.push({ task, variant, run, ...score(path.join(base, name)) });
  }
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(BENCH, ".runs", stamp);
  mkdirSync(base, { recursive: true });
  for (const task of tasks) {
    const taskDef = loadTask(task);
    const { prompt } = taskDef;
    for (const variant of variants) {
      for (let run = 1; run <= runs; run++) {
        const dir = path.join(base, `${task}__${variant}__${run}`);
        prepare(dir, variant, taskDef);
        process.stdout.write(`▶ ${task} / ${variant} / run ${run} … `);
        const sessions = prompt.split(SESSION_SPLIT).map((p) => p.trim()).filter(Boolean);
        const agent = { seconds: 0, cost: 0, ok: true };
        for (const [i, p] of sessions.entries()) {
          const r = runAgent(dir, p, i);
          agent.seconds += r.seconds;
          agent.cost = r.cost == null || agent.cost == null ? null : agent.cost + r.cost;
          agent.ok &&= r.ok;
        }
        const s = score(dir);
        console.log(`${s.violations} violation(s), loading ${s.loading}, ${agent.seconds}s${agent.ok ? "" : " (agent exited non-zero)"}`);
        rows.push({ task, variant, run, ...agent, ...s });
      }
    }
  }
  console.log(`\nRun dirs: ${base}`);
}

const report = `# Bench results — ${new Date().toISOString().slice(0, 10)}\n\nModel: ${values.model}\n\n${table(rows)}\n`;
mkdirSync(path.join(BENCH, "results"), { recursive: true });
const suffix = values["score-only"] ? `-rescore-${path.basename(path.resolve(values["score-only"]))}` : "";
const out = path.join(BENCH, "results", `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}${suffix}.md`);
writeFileSync(out, report);
console.log(report);
console.log(`Saved ${path.relative(process.cwd(), out)}`);
