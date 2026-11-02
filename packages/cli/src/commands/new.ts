import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getRule, loadContract, resolveContract } from "@gwinnguyen/fcs-core";

export type Template = "page" | "list";

export interface NewPageOptions {
  template?: Template;
  title?: string;
}

interface Segment {
  raw: string;
  /** Param name for dynamic segments. */
  param?: string;
  catchAll?: boolean;
  optional?: boolean;
  group: boolean;
}

function parseSegment(raw: string): Segment {
  const group = /^\(.*\)$/.test(raw) || raw.startsWith("@");
  const m = /^\[(\[)?(\.\.\.)?([^\]]+)\]?\]$/.exec(raw);
  if (!m) return { raw, group };
  return { raw, group: false, param: m[3]!, catchAll: Boolean(m[2]), optional: Boolean(m[1]) };
}

const words = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
const titleCase = (s: string) => words(s).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
const pascal = (s: string) => words(s).map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");

/** JS expression for a dynamic segment's value as a string. */
function paramExpr(s: Segment): string {
  if (!s.catchAll) return s.param!;
  return s.optional ? `(${s.param} ?? []).join("/")` : `${s.param}.join("/")`;
}

function paramType(s: Segment): string {
  if (!s.catchAll) return "string";
  return s.optional ? "string[] | undefined" : "string[]";
}

/**
 * Scaffold `app/<route>/page.tsx` (+ `loading.tsx`) on a page template, with breadcrumbs when the contract
 * requires them for this route depth. Returns written files relative to root.
 */
export function newPage(root: string, route: string, opts: NewPageOptions = {}): string[] {
  const template = opts.template ?? "page";
  if (template !== "page" && template !== "list") throw new Error(`unknown template "${template}" (page | list)`);
  const segments = route.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).map(parseSegment);
  const appDir = existsSync(path.join(root, "src/app")) ? "src/app" : "app";
  const dir = path.join(root, appDir, ...segments.map((s) => s.raw));
  const pageFile = path.join(dir, "page.tsx");
  if (existsSync(pageFile)) throw new Error(`${path.relative(root, pageFile)} already exists`);

  const resolved = resolveContract(loadContract(root));
  const mode = String(getRule(resolved, "layout.page-header")?.params.breadcrumb ?? "nested");
  const visible = segments.filter((s) => !s.group);
  const depth = visible.length;
  const wantCrumbs = (mode === "nested" && depth >= 2) || (mode === "always" && depth >= 1);

  const dynamic = visible.filter((s) => s.param);
  const last = visible.at(-1);
  const titleExpr = opts.title
    ? JSON.stringify(opts.title)
    : last
      ? last.param
        ? `{${paramExpr(last)}}`
        : JSON.stringify(titleCase(last.raw))
      : JSON.stringify("Home");
  // JSON string literals are valid JSX attribute strings unless they contain escapes.
  const titleAttr = titleExpr.startsWith("{") || !titleExpr.includes("\\") ? `title=${titleExpr}` : `title={${titleExpr}}`;

  // Crumbs: one per visible segment; the last one is the current page (no href).
  const crumbs: string[] = [];
  let href = "";
  visible.forEach((s, i) => {
    href += s.param ? `/\${${paramExpr(s)}}` : `/${s.raw}`;
    const isLast = i === visible.length - 1;
    const label = isLast ? (opts.title ? JSON.stringify(opts.title) : s.param ? paramExpr(s) : JSON.stringify(titleCase(s.raw))) : s.param ? paramExpr(s) : JSON.stringify(titleCase(s.raw));
    const hrefCode = href.includes("${") ? `\`${href}\`` : JSON.stringify(href);
    crumbs.push(isLast ? `{ label: ${label} }` : `{ label: ${label}, href: ${hrefCode} }`);
  });

  const Component = template === "list" ? "ListPage" : "Page";
  const importPath = template === "list" ? "@/components/fcs/list-page" : "@/components/fcs/page";
  const name = `${pascal(visible.map((s) => s.param ?? s.raw).join(" ")) || "Home"}Page`;
  const signature = dynamic.length
    ? `async function ${name}({ params }: { params: Promise<{ ${dynamic.map((s) => `${s.param}: ${paramType(s)}`).join("; ")} }> })`
    : `function ${name}()`;

  const props = [titleAttr];
  if (wantCrumbs) props.push(`breadcrumbs={[\n        ${crumbs.join(",\n        ")},\n      ]}`);

  const open = (indent: string) =>
    props.length === 1
      ? [`${indent}<${Component} ${props[0]}>`]
      : [`${indent}<${Component}`, ...props.map((p) => `${indent}  ${p.replace(/\n/g, `\n${indent.slice(4)}`)}`), `${indent}>`];

  const page = [
    `import { ${Component} } from "${importPath}";`,
    "",
    `export default ${signature} {`,
    ...(dynamic.length ? [`  const { ${dynamic.map((s) => s.param).join(", ")} } = await params;`, ""] : []),
    "  return (",
    ...open("    "),
    template === "list" ? "      {/* table or cards, wrapped in <AsyncBoundary skeleton=\"list\"> when data is async */}" : "      {/* content */}",
    `    </${Component}>`,
    "  );",
    "}",
    "",
  ].join("\n");

  // Same frame while loading, so the header does not jump — possible only when nothing depends on params.
  const variant = template === "list" ? "list" : "detail";
  const loading = dynamic.length === 0
    ? [
        `import { PageSkeleton } from "@/components/fcs/async-boundary";`,
        `import { ${Component} } from "${importPath}";`,
        "",
        "export default function Loading() {",
        "  return (",
        ...open("    "),
        `      <PageSkeleton variant="${variant}" />`,
        `    </${Component}>`,
        "  );",
        "}",
        "",
      ].join("\n")
    : [
        `import { PageSkeleton } from "@/components/fcs/async-boundary";`,
        "",
        "export default function Loading() {",
        `  return <PageSkeleton variant="${variant}" />;`,
        "}",
        "",
      ].join("\n");

  mkdirSync(dir, { recursive: true });
  writeFileSync(pageFile, page);
  const written = [path.relative(root, pageFile)];
  const loadingFile = path.join(dir, "loading.tsx");
  if (!existsSync(loadingFile)) {
    writeFileSync(loadingFile, loading);
    written.push(path.relative(root, loadingFile));
  }
  return written;
}
