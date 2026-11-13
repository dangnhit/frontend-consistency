import path from "node:path";
import type { Rule, Scope } from "eslint";
import {
  COMPONENTS_DIR,
  moduleKey,
  moduleOf,
  parseRef,
  patternsFor,
  type Forbid,
  type ResolvedPattern,
} from "@gwinnguyen/fcs-core";
import { loadResolved, primitivesDir, projectRoot } from "../contract.js";

type AnyNode = { type: string; parent?: AnyNode; [k: string]: unknown };

interface Imported {
  key: string;
  spec: string;
  /** Imported export name; `default` or `*` for default / namespace imports. */
  name: string;
}

/** `foo`, `window.confirm`, `toast.success` — null for computed or non-identifier callees. */
function calleeText(node: AnyNode): string | null {
  if (node.type === "Identifier") return node.name as string;
  if (node.type === "MemberExpression" && !node.computed) {
    const obj = calleeText(node.object as AnyNode);
    const prop = (node.property as AnyNode).name as string | undefined;
    return obj && prop ? `${obj}.${prop}` : null;
  }
  return null;
}

function jsxNameText(name: AnyNode | undefined): string | null {
  if (!name) return null;
  if (name.type === "JSXIdentifier") return name.name as string;
  if (name.type === "JSXMemberExpression") {
    const obj = jsxNameText(name.object as AnyNode);
    return obj ? `${obj}.${(name.property as AnyNode).name as string}` : null;
  }
  return null;
}

/** Every static string inside a className value: literals, template parts, and strings passed to cn()/clsx(). */
function classStrings(node: AnyNode | null | undefined, out: string[] = []): string[] {
  if (!node) return out;
  switch (node.type) {
    case "Literal":
      if (typeof node.value === "string") out.push(node.value);
      break;
    case "TemplateLiteral":
      for (const q of node.quasis as { value: { cooked: string } }[]) out.push(q.value.cooked);
      for (const e of node.expressions as AnyNode[]) classStrings(e, out);
      break;
    case "JSXExpressionContainer":
      classStrings(node.expression as AnyNode, out);
      break;
    case "CallExpression":
      for (const a of node.arguments as AnyNode[]) classStrings(a, out);
      break;
    case "ConditionalExpression":
      classStrings(node.consequent as AnyNode, out);
      classStrings(node.alternate as AnyNode, out);
      break;
    case "LogicalExpression":
      classStrings(node.right as AnyNode, out);
      break;
    case "ArrayExpression":
      for (const e of node.elements as AnyNode[]) classStrings(e, out);
      break;
    case "ObjectExpression":
      for (const p of node.properties as AnyNode[]) {
        const k = p.key as AnyNode | undefined;
        if (k?.type === "Literal" && typeof k.value === "string") out.push(k.value);
        else if (k?.type === "Identifier" && !p.computed) out.push(k.name as string);
      }
      break;
  }
  return out;
}

function tokenMatcher(spec: string): (token: string) => boolean {
  const m = /^\/(.+)\/([a-z]*)$/.exec(spec);
  if (m) {
    const re = new RegExp(m[1]!, m[2]);
    return (t) => re.test(t);
  }
  return (t) => t === spec;
}

/** Expressions a return can yield at the root: branches of ?: and && are each a root. */
function roots(expr: AnyNode | null | undefined): AnyNode[] {
  if (!expr) return [];
  if (expr.type === "ConditionalExpression") return [...roots(expr.consequent as AnyNode), ...roots(expr.alternate as AnyNode)];
  if (expr.type === "LogicalExpression") return roots(expr.right as AnyNode);
  if (expr.type === "AwaitExpression") return roots(expr.argument as AnyNode);
  if (expr.type === "ParenthesizedExpression") return roots(expr.expression as AnyNode);
  return [expr];
}

function isDeclaredLocally(scope: Scope.Scope | null, name: string): boolean {
  for (let s = scope; s; s = s.upper) if (s.set.has(name) && s.set.get(name)!.defs.length > 0) return true;
  return false;
}

function refsText(refs: string[]): string {
  return refs.map((r) => {
    const { module, name } = parseRef(r);
    return `<${name}> from ${module}`;
  }).join(" or ");
}

function describe(f: Forbid): string {
  if ("import" in f) return f.import.includes("#") ? `${parseRef(f.import).name} from ${moduleOf(f.import)}` : `${f.import}`;
  if ("element" in f) return `a raw <${f.element}>`;
  if ("className" in f) return `the \`${f.className}\` class`;
  if ("call" in f) return `${f.call}()`;
  return `text matching /${f.text}/i`;
}

function suffix(p: ResolvedPattern): string {
  return `${p.why ? ` ${p.why.trim()}` : ""} — pattern "${p.id}" in ${p.origin}${p.status === "proposed" ? " [proposed]" : ""}`;
}

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
      const refKey = (p: ResolvedPattern, ref: string) => moduleKey(parseRef(ref).module, path.join(p.base, "_"), p.base);
      const patterns = patternsFor(loaded.resolved.patterns, file).filter(
        (p) => (p.severity === "warn" ? "warn" : "error") === level && ![...p.use, ...p.root].some((r) => refKey(p, r) === fileKey),
      );
      if (!patterns.length) return {};

      const imports = new Map<string, Imported>(); // local name → import
      const report = (node: AnyNode, p: ResolvedPattern, what: string) =>
        context.report({
          node: node as unknown as Rule.Node,
          messageId: "forbid",
          data: { id: p.id, instead: p.use.length ? `Use ${refsText(p.use)} instead of` : "Do not use", what, suffix: suffix(p) },
        });

      const importMatches = (p: ResolvedPattern, spec: string, key: string, f: string) => {
        const mod = moduleOf(f);
        return spec === mod || key === moduleKey(mod, path.join(p.base, "_"), p.base);
      };

      const returns: { fn: AnyNode; expr: AnyNode | null }[] = [];
      const functions = new Map<string, AnyNode>();
      let defaultFn: AnyNode | null = null;
      let defaultName: string | null = null;
      const enclosingFn = (node: AnyNode): AnyNode | null => {
        for (let n = node.parent; n; n = n.parent) if (/Function/.test(n.type)) return n;
        return null;
      };

      return {
        ImportDeclaration(n) {
          const node = n as unknown as AnyNode;
          const spec = (node.source as { value: unknown }).value;
          if (typeof spec !== "string") return;
          const key = moduleKey(spec, file, root);
          for (const s of node.specifiers as AnyNode[]) {
            const name =
              s.type === "ImportDefaultSpecifier" ? "default" : s.type === "ImportNamespaceSpecifier" ? "*" : (((s.imported as AnyNode).name ?? (s.imported as AnyNode).value) as string);
            imports.set((s.local as AnyNode).name as string, { key, spec, name });
          }
          for (const p of patterns) {
            for (const f of p.forbid) {
              if (!("import" in f) || !importMatches(p, spec, key, f.import)) continue;
              if (!f.import.includes("#")) {
                report(node, p, describe(f));
                continue;
              }
              const want = parseRef(f.import).name;
              for (const s of node.specifiers as AnyNode[]) {
                const name = s.type === "ImportDefaultSpecifier" ? "default" : s.type === "ImportSpecifier" ? (((s.imported as AnyNode).name ?? (s.imported as AnyNode).value) as string) : null;
                if (name === want) report(s, p, describe(f));
              }
            }
          }
        },
        JSXOpeningElement(n: unknown) {
          const node = n as unknown as AnyNode;
          const name = jsxNameText(node.name as AnyNode);
          for (const p of patterns) {
            for (const f of p.forbid) {
              if ("element" in f && name === f.element) report(node, p, describe(f));
            }
          }
          const classAttrs = (node.attributes as AnyNode[]).filter(
            (a) => a.type === "JSXAttribute" && ["className", "class"].includes((a.name as AnyNode).name as string),
          );
          if (!classAttrs.length) return;
          const tokens = classAttrs.flatMap((a) => classStrings(a.value as AnyNode)).flatMap((s) => s.split(/\s+/)).filter(Boolean);
          for (const p of patterns) {
            for (const f of p.forbid) {
              if (!("className" in f)) continue;
              const match = tokenMatcher(f.className);
              const hit = tokens.find((t) => match(t.split(":").pop()!.replace(/^!/, "")));
              if (hit) report(node, p, describe(f));
            }
          }
        },
        CallExpression(n) {
          const node = n as unknown as AnyNode;
          const text = calleeText(node.callee as AnyNode);
          if (!text) return;
          for (const p of patterns) {
            for (const f of p.forbid) {
              if (!("call" in f)) continue;
              if (f.call.startsWith(".")) {
                if (text.endsWith(f.call) && text.includes(".")) report(node, p, `${f.call.slice(1)}()`);
                continue;
              }
              if (!(text === f.call || text.startsWith(`${f.call}.`))) continue;
              const head = text.split(".")[0]!;
              // `confirm()` from a local hook is not the browser global.
              if (!f.call.includes(".") && isDeclaredLocally(context.sourceCode.getScope(n), head)) continue;
              report(node, p, describe(f));
            }
          }
        },
        JSXText(n: unknown) {
          const node = n as unknown as AnyNode;
          const text = String(node.value).trim();
          if (!text) return;
          for (const p of patterns) {
            for (const f of p.forbid) {
              if ("text" in f && new RegExp(f.text, "i").test(text)) report(node, p, `the text "${text}"`);
            }
          }
        },
        FunctionDeclaration(n) {
          const node = n as unknown as AnyNode;
          const id = node.id as { name: string } | null;
          if (id) functions.set(id.name, node);
        },
        VariableDeclarator(n) {
          const node = n as unknown as AnyNode;
          const id = node.id as AnyNode;
          const init = node.init as AnyNode | null;
          if (id.type === "Identifier" && init && /Function/.test(init.type)) functions.set(id.name as string, init);
        },
        ExportDefaultDeclaration(n) {
          const decl = (n as unknown as AnyNode).declaration as AnyNode;
          if (/Function/.test(decl.type)) defaultFn = decl;
          else if (decl.type === "Identifier") defaultName = decl.name as string;
        },
        ReturnStatement(n) {
          const node = n as unknown as AnyNode;
          const fn = enclosingFn(node);
          if (fn) returns.push({ fn, expr: node.argument as AnyNode | null });
        },
        "Program:exit"() {
          const framed = patterns.filter((p) => p.root.length);
          if (!framed.length) return;
          const fn = defaultFn ?? (defaultName ? functions.get(defaultName) : undefined);
          if (!fn) return;
          const exprs =
            fn.type === "ArrowFunctionExpression" && (fn.body as AnyNode).type !== "BlockStatement"
              ? [fn.body as AnyNode]
              : returns.filter((r) => r.fn === fn).map((r) => r.expr);
          for (const p of framed) {
            const allowed = p.root.map((r) => ({ key: refKey(p, r), spec: parseRef(r).module, name: parseRef(r).name }));
            const ok = (local: string) => {
              const imp = imports.get(local);
              return !!imp && allowed.some((a) => (imp.key === a.key || imp.spec === a.spec) && imp.name === a.name);
            };
            for (const expr of exprs) {
              for (const r of roots(expr)) {
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
          }
        },
      } as Rule.RuleListener;
    },
  };
}
