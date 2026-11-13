import path from "node:path";
import type { Rule } from "eslint";
import { COMPONENTS_DIR, moduleKey, parseRef, patternsFor, type ResolvedPattern } from "@gwinnguyen/fcs-core";
import { loadResolved, primitivesDir, projectRoot } from "../contract.js";
import { jsxNameText, walkFile, type AnyNode, type Matcher } from "../signals.js";

function refsText(refs: string[]): string {
  return refs
    .map((r) => {
      const { module, name } = parseRef(r);
      return `<${name}> from ${module}`;
    })
    .join(" or ");
}

function suffix(p: ResolvedPattern): string {
  return `${p.why ? ` ${p.why.trim()}` : ""} — pattern "${p.id}" in ${p.origin}${p.status === "proposed" ? " [proposed]" : ""}`;
}

const refKey = (p: ResolvedPattern, ref: string) => moduleKey(parseRef(ref).module, path.join(p.base, "_"), p.base);

/**
 * `fcs/pattern` (severity error) and `fcs/pattern-warn` (severity warn): enforce the project's own patterns
 * (`patterns:` in .design/contract.yaml). ESLint fixes severity per rule, hence two rules sharing one implementation.
 */
export function createPatternRule(level: "error" | "warn"): Rule.RuleModule {
  const ruleName = level === "error" ? "fcs/pattern" : "fcs/pattern-warn";
  return {
    meta: {
      type: "problem",
      docs: { description: `Enforce the project's own UI patterns (contract \`patterns:\` with severity ${level}).` },
      schema: [],
      messages: {
        forbid: `${ruleName}({{id}}): {{instead}} {{what}}.{{suffix}}`,
        root: `${ruleName}({{id}}): The default export returns {{what}} at its root. Return {{roots}} and put the content inside it.{{suffix}}`,
        contract: "fcs: cannot load design contract — {{error}}",
      },
    },
    create(context) {
      const root = projectRoot(context);
      const loaded = loadResolved(root);
      if (!loaded.ok) {
        if (level === "warn") return {};
        return {
          Program(node) {
            context.report({ node, messageId: "contract", data: { error: loaded.error.split("\n")[0] ?? "" } });
          },
        };
      }
      const file = path.resolve(context.filename);
      const relPath = path.relative(root, file).split(path.sep).join("/");
      if (relPath.startsWith(`${COMPONENTS_DIR}/`) || relPath.startsWith(`${primitivesDir(root)}/`)) return {};

      const fileKey = file.replace(/(\/index)?\.[cm]?[jt]sx?$/, "");
      const patterns = patternsFor(loaded.resolved.patterns, file).filter(
        (p) => (p.severity === "warn" ? "warn" : "error") === level && ![...p.use, ...p.root].some((r) => refKey(p, r) === fileKey),
      );
      if (!patterns.length) return {};

      const matchers: Matcher<ResolvedPattern>[] = patterns.flatMap((p) => p.forbid.map((forbid) => ({ tag: p, forbid, base: p.base })));
      return walkFile(
        context,
        root,
        matchers,
        ({ tag: p, node, what }) =>
          context.report({
            node: node as unknown as Rule.Node,
            messageId: "forbid",
            data: { id: p.id, instead: p.use.length ? `Use ${refsText(p.use)} instead of` : "Do not use", what, suffix: suffix(p) },
          }),
        (walk) => {
          const framed = patterns.filter((p) => p.root.length);
          if (!framed.length) return;
          const exprs = walk.defaultRoots();
          if (!exprs) return;
          for (const p of framed) {
            const allowed = p.root.map((r) => ({ key: refKey(p, r), spec: parseRef(r).module, name: parseRef(r).name }));
            const ok = (local: string) => {
              const imp = walk.imports.get(local);
              return !!imp && allowed.some((a) => (imp.key === a.key || imp.spec === a.spec) && imp.name === a.name);
            };
            for (const r of exprs) {
              if ((r.type === "Literal" && r.value === null) || r.type === "CallExpression") continue;
              let what: string;
              if (r.type === "JSXElement") {
                const name = jsxNameText((r.openingElement as AnyNode).name as AnyNode);
                if (name && ok(name.split(".")[0]!)) continue;
                what = name ? `<${name}>` : "an element";
              } else what = r.type === "JSXFragment" ? "a fragment" : "a non-element value";
              context.report({
                node: r as unknown as Rule.Node,
                messageId: "root",
                data: { id: p.id, what, roots: refsText(p.root), suffix: suffix(p) },
              });
            }
          }
        },
      );
    },
  };
}
