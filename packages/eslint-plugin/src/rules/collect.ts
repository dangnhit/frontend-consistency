import path from "node:path";
import type { Rule } from "eslint";
import { CONCERNS } from "@gwinnguyen/fcs-core";
import { describeForbid, jsxNameText, walkFile, type AnyNode, type Imported, type Matcher } from "../signals.js";

/** What `fcs scan` needs to know about one file. */
export interface FileFacts {
  /** POSIX path relative to the scan root. */
  file: string;
  /** Catalog signals found: concern id + matcher description + the exported top-level symbol containing it. */
  hits: { concern: string; signal: string; line: number; owner?: string }[];
  imports: Imported[];
  exported: string[];
  /** Root elements returned by the default export (one per return branch). */
  defaultRoots: ({ kind: "component"; local: string; key: string; spec: string; name: string } | { kind: "element"; tag: string } | { kind: "other" })[];
}

/** Name declared by the top-level statement containing `node` (`default` for a default export). */
function topLevelName(node: AnyNode): string | undefined {
  let n: AnyNode | undefined = node;
  while (n?.parent && n.parent.type !== "Program") n = n.parent;
  if (!n) return undefined;
  if (n.type === "ExportDefaultDeclaration") return "default";
  const decl = n.type === "ExportNamedDeclaration" ? (n.declaration as AnyNode | null) : n;
  if (!decl) return undefined;
  if (decl.type === "VariableDeclaration") {
    const id = ((decl.declarations as AnyNode[])[0]?.id as AnyNode | undefined);
    return id?.type === "Identifier" ? (id.name as string) : undefined;
  }
  const id = decl.id as AnyNode | null | undefined;
  return id?.type === "Identifier" ? (id.name as string) : undefined;
}

/**
 * Not a lint rule: records every catalog signal plus imports/exports into `sink`, so `fcs scan` counts with exactly
 * the matchers `fcs/pattern` enforces.
 */
export function createCollectRule(root: string, sink: FileFacts[]): Rule.RuleModule {
  const matchers: Matcher<string>[] = CONCERNS.flatMap((c) => c.signals.map((forbid) => ({ tag: c.id, forbid, base: root })));
  return {
    meta: { type: "suggestion", schema: [], docs: { description: "fcs scan collector" } },
    create(context) {
      const facts: FileFacts = {
        file: path.relative(root, path.resolve(context.filename)).split(path.sep).join("/"),
        hits: [],
        imports: [],
        exported: [],
        defaultRoots: [],
      };
      return walkFile(
        context,
        root,
        matchers,
        ({ tag, forbid, node }) => {
          const owner = topLevelName(node);
          facts.hits.push({ concern: tag, signal: describeForbid(forbid), line: node.loc?.start.line ?? 0, ...(owner && { owner }) });
        },
        (walk) => {
          // Keep owners only when they are exported: the symbol other files could use.
          for (const h of facts.hits) if (h.owner && !walk.exported.has(h.owner)) delete h.owner;
          facts.imports = [...walk.imports.values()];
          facts.exported = [...walk.exported];
          for (const r of walk.defaultRoots() ?? []) {
            if (r.type === "Literal" && r.value === null) continue;
            if (r.type === "CallExpression") continue;
            if (r.type !== "JSXElement") {
              facts.defaultRoots.push({ kind: "other" });
              continue;
            }
            const name = jsxNameText((r.openingElement as AnyNode).name as AnyNode) ?? "";
            const local = name.split(".")[0]!;
            const imp = walk.imports.get(local);
            if (imp) facts.defaultRoots.push({ kind: "component", local, key: imp.key, spec: imp.spec, name: imp.name });
            else facts.defaultRoots.push({ kind: "element", tag: name });
          }
          sink.push(facts);
        },
      );
    },
  };
}
