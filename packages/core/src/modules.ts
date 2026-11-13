import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const EXTS = [".tsx", ".ts", ".jsx", ".js", ".mts", ".cts", ".mjs", ".cjs"];

interface Aliases {
  baseDir: string;
  /** `[prefix, targets]` for `"@/*": ["./src/*"]`-style entries; exact aliases have no `*`. */
  paths: [string, string[]][];
}

const aliasCache = new Map<string, Aliases>();

/** Parse tsconfig/jsconfig, tolerating comments and trailing commas. */
function readJsonc(file: string): unknown {
  const text = readFileSync(file, "utf8")
    .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, str: string | undefined) => str ?? "")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(text);
}

function aliasesFor(root: string): Aliases {
  let a = aliasCache.get(root);
  if (a) return a;
  a = { baseDir: root, paths: [["@/*", ["./*"]]] };
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    try {
      const opts = (readJsonc(file) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }).compilerOptions;
      if (opts?.paths) a = { baseDir: path.resolve(root, opts.baseUrl ?? "."), paths: Object.entries(opts.paths) };
    } catch {
      // keep the Next.js default
    }
    break;
  }
  aliasCache.set(root, a);
  return a;
}

export function clearModuleCache(): void {
  aliasCache.clear();
}

function withExtension(base: string): string | null {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTS) if (existsSync(base + ext)) return base + ext;
  for (const ext of EXTS) {
    const index = path.join(base, `index${ext}`);
    if (existsSync(index)) return index;
  }
  return null;
}

/**
 * Absolute file for an import specifier, or null for packages and anything unresolvable.
 * Handles relative paths and tsconfig `paths` aliases (default `@/*` → project root, as in Next.js).
 */
export function resolveModuleFile(spec: string, fromFile: string, root: string): string | null {
  if (spec.startsWith(".")) return withExtension(path.resolve(path.dirname(fromFile), spec));
  const { baseDir, paths } = aliasesFor(root);
  for (const [pattern, targets] of paths) {
    const star = pattern.indexOf("*");
    const match = star === -1 ? (spec === pattern ? "" : null) : spec.startsWith(pattern.slice(0, star)) && spec.endsWith(pattern.slice(star + 1)) ? spec.slice(star, spec.length - (pattern.length - star - 1)) : null;
    if (match === null) continue;
    for (const t of targets) {
      const file = withExtension(path.resolve(baseDir, t.replace("*", match)));
      if (file) return file;
    }
  }
  return null;
}

/**
 * Stable identity for a module: the resolved file (extension-less) when it is in the project, else the specifier.
 * Two specifiers name the same module iff their keys are equal.
 */
export function moduleKey(spec: string, fromFile: string, root: string): string {
  const file = resolveModuleFile(spec, fromFile, root);
  return file ? file.replace(/(\/index)?\.[cm]?[jt]sx?$/, "") : spec;
}
