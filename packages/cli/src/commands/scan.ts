import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";
import fcs, { clearContractCache, createCollectRule, type FileFacts } from "@gwinnguyen/eslint-plugin-fcs";
import {
  CONCERNS,
  compileGlobs,
  getConcern,
  loadContract,
  resolveContract,
  resolveModuleFile,
  writePatterns,
  type Forbid,
  type ResolvedContract,
} from "@gwinnguyen/fcs-core";
import { readBaseline, violationKey, writeBaseline } from "../baseline.js";
import { recordDecision } from "../decisions.js";
import { DEFAULT_IGNORES, lintContract } from "../lint.js";
import { readLock } from "../lock.js";
import { build, describeBuild } from "./build.js";

/** One way a concern is implemented in this codebase. */
export interface Variant {
  label: string;
  kind: "component" | "raw";
  /** Component variants: `module#Export` usable in `use` / `root`. */
  ref?: string;
  /** Component variants: the defining file. */
  definedIn?: string;
  /** Component variants: how many symbols the defining file exports (a shared module is not locked whole). */
  definedInExports?: number;
  /** Raw variants: catalog signals (or a root element) that make up the signature. */
  signals?: string[];
  files: string[];
  /** Example locations (`file:line`). */
  at: string[];
  /** Most recent mtime among the files (ms). */
  lastChange: number;
  /** Per-scope file counts when the contract defines scopes. */
  byScope?: Record<string, number>;
}

export interface ConcernScan {
  concern: string;
  title: string;
  variants: Variant[];
  /** Pattern ids already in force for this concern. */
  existing: string[];
  /** Label of the suggested variant (most files, then most recent). Absent when nothing to suggest. */
  suggested?: string;
  /** Each scope uses exactly one variant and scopes differ: per-scope patterns suggested. */
  splitByScope?: Record<string, string>;
}

export interface ScanResult {
  files: number;
  concerns: ConcernScan[];
  notFound: string[];
  /** Scopes derived from App Router route groups when the contract defines none: name → include globs. */
  areas?: Record<string, string[]>;
}

const SOURCE_GLOB = ["**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}"];
const keyOfFile = (abs: string) => abs.replace(/(\/index)?\.[cm]?[jt]sx?$/, "");

async function collect(root: string): Promise<FileFacts[]> {
  const sink: FileFacts[] = [];
  const [base] = fcs.config({ root });
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      { ignores: DEFAULT_IGNORES },
      {
        files: SOURCE_GLOB,
        languageOptions: base!.languageOptions,
        plugins: { "fcs-scan": { rules: { collect: createCollectRule(root, sink) } } },
        rules: { "fcs-scan/collect": "error" },
      },
    ],
    allowInlineConfig: false,
    errorOnUnmatchedPattern: false,
  });
  await eslint.lintFiles(["."]);
  return sink;
}

function primitivesDir(root: string): string {
  try {
    const json = JSON.parse(readFileSync(path.join(root, "components.json"), "utf8")) as { aliases?: { ui?: string } };
    const alias = json.aliases?.ui;
    if (alias) return alias.replace(/^[@~#]\//, "").replace(/\/$/, "");
  } catch {
    // default
  }
  return "components/ui";
}

function mtime(root: string, rel: string): number {
  try {
    return statSync(path.join(root, rel)).mtimeMs;
  } catch {
    return 0;
  }
}

/** A `module#Export` ref for a project file: the alias importers used if any, else a root-relative path. */
function refFor(root: string, abs: string, name: string, specs: string[]): string {
  const alias = specs.find((s) => !s.startsWith(".") && resolveModuleFile(s, path.join(root, "_"), root) === abs);
  const mod = alias ?? `./${path.relative(root, abs).split(path.sep).join("/").replace(/(\/index)?\.[cm]?[jt]sx?$/, "")}`;
  return `${mod}#${name}`;
}

export async function scan(root: string, resolved?: ResolvedContract): Promise<ScanResult> {
  const facts = await collect(root);
  const contract = resolved ?? resolveContract(loadContract(root));
  const prim = `${primitivesDir(root)}/`;
  const lock = readLock(root);
  // Sanctioned building blocks: registry components and files the project already locked.
  const sanctioned = (rel: string) => rel.startsWith("components/fcs/") || rel in lock.files || rel in lock.project;
  const abs = (rel: string) => path.join(root, rel);

  // importers: file key → importing file → imported names
  const importers = new Map<string, Map<string, { names: Set<string>; specs: Set<string> }>>();
  for (const f of facts) {
    for (const imp of f.imports) {
      if (!imp.key.startsWith("/")) continue; // packages
      const byFile = importers.get(imp.key) ?? importers.set(imp.key, new Map()).get(imp.key)!;
      const entry = byFile.get(f.file) ?? byFile.set(f.file, { names: new Set(), specs: new Set() }).get(f.file)!;
      entry.names.add(imp.name);
      entry.specs.add(imp.spec);
    }
  }

  // Scopes: the contract's, or areas from route groups (`app/(admin)/…`) so per-area differences show up.
  let areas: Record<string, string[]> | undefined;
  let scopeDefs = Object.entries(contract.scopes).map(([name, def]) => ({ name, include: def.include, exclude: def.exclude }));
  if (!scopeDefs.length) {
    const groups = new Map<string, string>();
    for (const f of facts) {
      const m = /^((?:src\/)?app\/\(([^)]+)\))\//.exec(f.file);
      if (m && /^[\w-]+$/.test(m[2]!)) groups.set(m[2]!, `${m[1]}/**`);
    }
    if (groups.size > 1) {
      areas = Object.fromEntries([...groups].sort().map(([name, glob]) => [name, [glob]]));
      scopeDefs = Object.entries(areas).map(([name, include]) => ({ name, include, exclude: [] }));
    }
  }
  const scopes = scopeDefs.map((d) => ({ name: d.name, test: (rel: string) => compileGlobs(d.include)(rel) && !compileGlobs(d.exclude)(rel) }));
  const finish = (v: Omit<Variant, "label" | "lastChange" | "byScope">): Omit<Variant, "label"> => {
    const files = [...new Set(v.files)].sort();
    const out: Omit<Variant, "label"> = { ...v, files, lastChange: Math.max(0, ...files.map((f) => mtime(root, f))) };
    if (scopes.length) out.byScope = Object.fromEntries(scopes.map((s) => [s.name, files.filter(s.test).length]));
    return out;
  };

  const concerns: ConcernScan[] = [];
  const notFound: string[] = [];
  for (const c of CONCERNS) {
    const raw: Omit<Variant, "label">[] = [];
    if (c.rootFiles) {
      const isRoute = compileGlobs(c.rootFiles);
      const groups = new Map<string, Omit<Variant, "label" | "lastChange" | "byScope">>();
      for (const f of facts.filter((x) => isRoute(x.file))) {
        for (const r of f.defaultRoots) {
          if (r.kind === "other") continue;
          let id: string;
          let v: Omit<Variant, "label" | "lastChange" | "byScope">;
          if (r.kind === "component") {
            const file = r.key.startsWith("/") ? resolveModuleFile(r.spec, abs(f.file), root) : null;
            const ref = file ? refFor(root, file, r.name, [r.spec]) : `${r.spec}#${r.name}`;
            id = `c:${r.key}#${r.name}`;
            v = { kind: "component", ref, ...(file && { definedIn: path.relative(root, file).split(path.sep).join("/") }), files: [], at: [] };
          } else {
            id = `e:${r.tag}`;
            v = { kind: "raw", signals: [`<${r.tag}> built in the page`], files: [], at: [] };
          }
          const g = groups.get(id) ?? groups.set(id, v).get(id)!;
          g.files.push(f.file);
          if (g.at.length < 2) g.at.push(f.file);
        }
      }
      raw.push(...[...groups.values()].map(finish));
    } else {
      const withHits = facts.filter((f) => !f.file.startsWith(prim) && f.hits.some((h) => h.concern === c.id));
      const implName = c.names ? new RegExp(c.names, "i") : null;
      const wrappers = new Map<string, Omit<Variant, "label" | "lastChange" | "byScope">>();
      const rawGroups = new Map<string, Omit<Variant, "label" | "lastChange" | "byScope">>();
      for (const f of withHits) {
        const users = [...(importers.get(keyOfFile(abs(f.file)))?.entries() ?? [])].filter(([file]) => file !== f.file);
        const hits = f.hits.filter((h) => h.concern === c.id);
        const base = path.basename(f.file).replace(/\.[^.]+$/, "");
        const rawHits: typeof hits = [];
        // Import-level signals sit outside any export: attribute them to the export implementing the concern.
        const exportsNamed = f.exported.filter((e) => e !== "default" && (!implName || implName.test(e)));
        const fileOwner = exportsNamed.length === 1 ? exportsNamed[0] : f.exported.length === 1 ? f.exported[0] : undefined;
        const byOwner = new Map<string | undefined, typeof hits>();
        for (const h of hits) {
          const owner = h.owner ?? fileOwner;
          (byOwner.get(owner) ?? byOwner.set(owner, []).get(owner)!).push(h);
        }

        for (const [owner, hs] of byOwner) {
          // Shared implementation of the concern: an export named for it (or a sanctioned file) that others import.
          const named = !!owner && (!implName || implName.test(owner === "default" ? base : owner) || implName.test(base));
          if (owner && (named || sanctioned(f.file))) {
            let ownerUsers = users.filter(([, e]) => e.names.has(owner));
            let name = owner;
            if (!ownerUsers.length && sanctioned(f.file) && users.length) {
              // Registry components compose internally (Page renders PageHeader): attribute to what others import.
              const counts = new Map<string, number>();
              for (const [, e] of users) for (const n of e.names) if (n !== "*") counts.set(n, (counts.get(n) ?? 0) + 1);
              name = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? owner;
              ownerUsers = users.filter(([, e]) => e.names.has(name));
            }
            if (ownerUsers.length) {
              const id = `${f.file}#${name}`;
              const w = wrappers.get(id) ?? wrappers.set(id, {
                kind: "component",
                ref: refFor(root, abs(f.file), name, ownerUsers.flatMap(([, e]) => [...e.specs])),
                definedIn: f.file,
                definedInExports: f.exported.length,
                files: [],
                at: [],
              }).get(id)!;
              w.files.push(...ownerUsers.map(([file]) => file));
              w.at = w.files.slice(0, 2);
              continue;
            }
            if (sanctioned(f.file)) continue; // unused registry/locked component says nothing about the codebase
          }
          rawHits.push(...hs);
        }
        if (!rawHits.length || sanctioned(f.file)) continue;
        const signature = [...new Set(rawHits.map((h) => h.signal))].sort();
        const id = signature.join(" + ");
        const g = rawGroups.get(id) ?? rawGroups.set(id, { kind: "raw", signals: signature, files: [], at: [] }).get(id)!;
        g.files.push(f.file);
        if (g.at.length < 2) g.at.push(`${f.file}:${rawHits[0]!.line}`);
      }
      raw.push(...[...wrappers.values(), ...rawGroups.values()].map(finish));
    }

    const existing = contract.patterns.filter((p) => p.concern === c.id).map((p) => p.id);
    if (!raw.length) {
      if (!existing.length) notFound.push(c.id);
      continue;
    }
    raw.sort((a, b) => b.files.length - a.files.length || b.lastChange - a.lastChange || (a.ref ?? "").localeCompare(b.ref ?? ""));
    const variants = raw.map((v, i) => ({ ...v, label: String.fromCharCode(65 + i) }));
    const scan: ConcernScan = { concern: c.id, title: c.title, variants, existing };
    if (!existing.length) scan.suggested = variants[0]!.label;
    if (scopes.length && variants.length > 1) {
      const split: Record<string, string> = {};
      let clean = true;
      for (const s of scopes) {
        const used = variants.filter((v) => (v.byScope?.[s.name] ?? 0) > 0);
        if (used.length > 1) clean = false;
        if (used.length === 1) split[s.name] = used[0]!.label;
      }
      // Only meaningful when most usages live inside the scopes (shared components/ code is outside every area).
      const all = new Set(variants.flatMap((v) => v.files));
      const inside = [...all].filter((f) => scopes.some((sc) => sc.test(f))).length;
      if (clean && new Set(Object.values(split)).size > 1 && inside / all.size >= 0.8) scan.splitByScope = split;
    }
    concerns.push(scan);
  }
  return { files: facts.length, concerns, notFound, ...(areas && { areas }) };
}

function ago(ms: number): string {
  if (!ms) return "";
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  return d <= 0 ? "changed today" : `last change ${d}d ago`;
}

function variantName(v: Variant): string {
  if (v.kind === "component") return `<${v.ref!.split("#")[1]}> ${v.ref!.split("#")[0]}`;
  return v.signals!.join(" + ");
}

export function formatScan(r: ScanResult): string {
  const out: string[] = [`fcs scan: ${r.files} files, ${r.concerns.length} UI concern(s) found in code`];
  if (r.areas) out.push(`areas (from route groups; per-area counts shown): ${Object.keys(r.areas).join(", ")}`);
  for (const c of r.concerns) {
    const n = c.variants.length;
    const state = c.existing.length ? `pattern ${c.existing.map((e) => `"${e}"`).join(", ")} in force` : n === 1 ? "1 variant (consistent)" : `${n} variants`;
    out.push("", `${c.concern} — ${state}`);
    for (const v of c.variants) {
      const where = v.kind === "raw" || n > 1 ? `  ${v.at.join(", ")}${v.files.length > v.at.length ? ", …" : ""}` : "";
      const inScopes = v.byScope ? Object.entries(v.byScope).filter(([, k]) => k > 0) : [];
      const scopes = inScopes.length ? `  [${inScopes.map(([s, k]) => `${s} ${k}`).join(" · ")}]` : "";
      const mark =
        c.suggested === v.label && !c.splitByScope
          ? n === 1 && v.kind === "component"
            ? "  ← adopt as-is (--write)"
            : v.kind === "raw"
              ? "  ← most used, but no shared component: consider extracting one"
              : "  ← suggested (most used)"
          : "";
      out.push(`  ${v.label}  ${variantName(v)}  ${v.files.length} file(s)  ${ago(v.lastChange)}${scopes}${where}${mark}`);
    }
    if (c.existing.length) continue;
    if (c.splitByScope) {
      out.push(`  → each scope uses one variant: ${Object.entries(c.splitByScope).map(([s, l]) => `--decide ${c.concern}@${s}=${l}`).join(" ")}`);
      out.push(`  → or one pattern for all: --decide ${c.concern}=${c.variants.map((v) => v.label).join("|")}`);
    } else if (n > 1) {
      out.push(`  → choose: --decide ${c.concern}=${c.variants.map((v) => v.label).join("|")}`);
    }
  }
  if (r.notFound.length) out.push("", `not found in code: ${r.notFound.join(", ")}`);
  return out.join("\n");
}

export interface ScanDecision {
  concern: string;
  scope?: string;
  label: string;
}

export function parseScanDecisions(raw: string[]): ScanDecision[] {
  return raw.map((d) => {
    const m = /^([a-z][a-z0-9-]*)(?:@([\w-]+))?=([A-Z])$/.exec(d);
    if (!m) throw new Error(`--decide "${d}": expected <concern>=<variant letter>, or <concern>@<scope>=<letter>`);
    return { concern: m[1]!, ...(m[2] && { scope: m[2] }), label: m[3]! };
  });
}

/** Pattern definition for a chosen variant. */
function patternFor(c: ConcernScan, v: Variant, scope?: string): Record<string, unknown> {
  const concern = getConcern(c.concern)!;
  const base: Record<string, unknown> = scope ? { concern: c.concern, scope } : {};
  if (concern.rootFiles) {
    if (v.kind !== "component") {
      throw new Error(`${c.concern}=${v.label}: pages build <${v.signals![0]}> by hand — extract a frame component first, then scan again`);
    }
    return { ...base, files: concern.rootFiles.length === 1 ? concern.rootFiles[0] : concern.rootFiles, root: [v.ref] };
  }
  if (v.kind === "component") {
    // Locking guards a component; a shared module (utils with many exports) would freeze unrelated code.
    return { ...base, use: v.ref, ...((v.definedInExports ?? 1) > 1 && { lock: false }) };
  }
  // Raw variant: allow its signals, forbid the rest of the catalog.
  const keep = new Set(v.signals);
  return {
    ...base,
    forbid: concern.signals.filter((s) => !keep.has(describeSignal(s))),
    why: `The project uses ${v.signals!.join(" + ")} directly; extract a shared component when convenient.`,
  };
}

/** Same wording as describeForbid in the eslint plugin, so scan signatures match catalog signals. */
function describeSignal(s: Forbid): string {
  if ("import" in s) return s.import.includes("#") ? `${s.import.split("#")[1]} from ${s.import.split("#")[0]}` : s.import;
  if ("element" in s) return `a raw <${s.element}>`;
  if ("className" in s) return `the \`${s.className}\` class`;
  if ("call" in s) return `${s.call.replace(/^\./, "")}()`;
  return `text matching /${s.text}/i`;
}

export interface ScanWriteResult {
  report: string;
  written: string[];
}

/** Write chosen patterns (plus consistent component concerns), record the decision, build, baseline the leftovers. */
export async function writeScan(root: string, result: ScanResult, decisions: ScanDecision[]): Promise<ScanWriteResult> {
  const loaded = loadContract(root);
  const patterns: Record<string, Record<string, unknown>> = {};
  const newScopes: Record<string, { include: string[] }> = {};
  const record: string[] = [];
  const byConcern = new Map(result.concerns.map((c) => [c.concern, c]));

  for (const d of decisions) {
    const c = byConcern.get(d.concern);
    if (!c) throw new Error(`--decide ${d.concern}: not found in code (concerns found: ${[...byConcern.keys()].join(", ") || "none"})`);
    if (c.existing.length) throw new Error(`--decide ${d.concern}: pattern ${c.existing.join(", ")} already in force; edit .design/contract.yaml`);
    const v = c.variants.find((x) => x.label === d.label);
    if (!v) throw new Error(`--decide ${d.concern}=${d.label}: variants are ${c.variants.map((x) => x.label).join(", ")}`);
    if (d.scope && !(d.scope in loaded.contract.scopes)) {
      const area = result.areas?.[d.scope];
      if (!area) throw new Error(`--decide ${d.concern}@${d.scope}: no scope "${d.scope}" in contract.yaml`);
      newScopes[d.scope] = { include: area };
    }
    const id = d.scope ? `${d.concern}-${d.scope}` : d.concern;
    patterns[id] = patternFor(c, v, d.scope);
    record.push(`- \`${id}\` = ${d.label}: ${variantName(v)} (${v.files.length} files) — chosen over ${c.variants.filter((x) => x !== v).map((x) => `${x.label} ${variantName(x)} (${x.files.length})`).join(", ") || "nothing else"}`);
  }
  for (const c of result.concerns) {
    if (c.existing.length || c.variants.length !== 1 || c.variants[0]!.kind !== "component") continue;
    if (decisions.some((d) => d.concern === c.concern)) continue;
    patterns[c.concern] = patternFor(c, c.variants[0]!);
    record.push(`- \`${c.concern}\` = ${variantName(c.variants[0]!)} (${c.variants[0]!.files.length} files) — already consistent, adopted as-is`);
  }
  const undecided = result.concerns.filter((c) => !c.existing.length && c.variants.length > 1 && !decisions.some((d) => d.concern === c.concern));

  const lines: string[] = [];
  if (!Object.keys(patterns).length) {
    lines.push("Nothing to write: no consistent shared components, and no --decide given.");
    return { report: lines.join("\n"), written: [] };
  }
  writePatterns(loaded.contractFile, patterns, newScopes);
  lines.push(`✓ ${Object.keys(patterns).length} pattern(s) written to ${path.relative(root, loaded.contractFile)}: ${Object.keys(patterns).join(", ")}`);
  const decision = recordDecision(root, "scan", [
    "# Patterns from `fcs scan`",
    "",
    ...record,
    ...(undecided.length ? ["", `Still open (several variants, no decision yet): ${undecided.map((c) => c.concern).join(", ")}`] : []),
  ]);
  lines.push(`✓ recorded ${decision}`);
  for (const w of build(root).filter((x) => x.changed)) lines.push(w.lockedFor ? describeBuild(w) : `✓ generated ${w.file}`);

  // Existing usages of the losing variants become baselined debt instead of a red CI.
  const ids = new Set(Object.keys(patterns));
  clearContractCache(); // the contract just changed
  const lint = await lintContract(root);
  const debt = lint.filter((m) => {
    const k = violationKey(m);
    const id = k && /^fcs\/pattern(?:-warn)?\(([^)]+)\)$/.exec(k)?.[1];
    return id && ids.has(id);
  });
  if (debt.length) {
    const b = readBaseline(root) ?? { version: 1 as const, files: {} };
    for (const m of debt) {
      const k = violationKey(m)!;
      const f = (b.files[m.file] ??= {});
      f[k] = (f[k] ?? 0) + 1;
    }
    writeBaseline(root, b);
    lines.push(`✓ baselined ${debt.length} existing usage(s) of the other variants in ${new Set(debt.map((m) => m.file)).size} file(s) — they fail only if they grow`);
  }
  if (undecided.length) lines.push(`· still open: ${undecided.map((c) => c.concern).join(", ")} (several variants; --decide to settle)`);
  return { report: lines.join("\n"), written: Object.keys(patterns) };
}

