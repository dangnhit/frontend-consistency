import path from "node:path";
import type { Rule, Scope } from "eslint";
import { moduleKey, moduleOf, parseRef, type Forbid } from "@gwinnguyen/fcs-core";

/**
 * Shared file walk for `fcs/pattern` (report signals a pattern forbids) and `fcs scan` (collect every catalog signal).
 * One implementation so that what the scan counts is exactly what the lint enforces.
 */

export type AnyNode = { type: string; parent?: AnyNode; loc?: { start: { line: number } }; [k: string]: unknown };

export interface Imported {
  key: string;
  spec: string;
  /** Imported export name; `default` or `*` for default / namespace imports. */
  name: string;
}

export interface Matcher<T> {
  tag: T;
  forbid: Forbid;
  /** Root that relative / aliased modules in `forbid.import` resolve against. */
  base: string;
}

export interface Hit<T> {
  tag: T;
  forbid: Forbid;
  node: AnyNode;
  /** Human description of what was found, e.g. `Loader2 from lucide-react`, `the text "Loading..."`. */
  what: string;
}

export interface FileWalk {
  /** local name → import */
  imports: Map<string, Imported>;
  /** Names this file exports (`default` included). */
  exported: Set<string>;
  /** Root expressions returned by the default export, or null when it is not a function. */
  defaultRoots(): AnyNode[] | null;
}

/** `foo`, `window.confirm`, `toast.success`; null for computed or non-identifier callees. */
export function calleeText(node: AnyNode): string | null {
  if (node.type === "Identifier") return node.name as string;
  if (node.type === "MemberExpression" && !node.computed) {
    const obj = calleeText(node.object as AnyNode);
    const prop = (node.property as AnyNode).name as string | undefined;
    return obj && prop ? `${obj}.${prop}` : null;
  }
  return null;
}

export function jsxNameText(name: AnyNode | undefined): string | null {
  if (!name) return null;
  if (name.type === "JSXIdentifier") return name.name as string;
  if (name.type === "JSXMemberExpression") {
    const obj = jsxNameText(name.object as AnyNode);
    return obj ? `${obj}.${(name.property as AnyNode).name as string}` : null;
  }
  return null;
}

/** Every static string inside a className value: literals, template parts, strings passed to cn()/clsx(). */
export function classStrings(node: AnyNode | null | undefined, out: string[] = []): string[] {
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

export function tokenMatcher(spec: string): (token: string) => boolean {
  const m = /^\/(.+)\/([a-z]*)$/.exec(spec);
  if (m) {
    const re = new RegExp(m[1]!, m[2]);
    return (t) => re.test(t);
  }
  return (t) => t === spec;
}

/** Expressions a return can yield at the root: branches of ?: and && are each a root. */
export function roots(expr: AnyNode | null | undefined): AnyNode[] {
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

/** Human description of a matcher, for messages and scan reports. */
export function describeForbid(f: Forbid): string {
  if ("import" in f) return f.import.includes("#") ? `${parseRef(f.import).name} from ${moduleOf(f.import)}` : `${f.import}`;
  if ("element" in f) return `a raw <${f.element}>`;
  if ("className" in f) return `the \`${f.className}\` class`;
  if ("call" in f) return `${f.call.replace(/^\./, "")}()`;
  return `text matching /${f.text}/i`;
}

const importName = (s: AnyNode): string =>
  s.type === "ImportDefaultSpecifier"
    ? "default"
    : s.type === "ImportNamespaceSpecifier"
      ? "*"
      : (((s.imported as AnyNode).name ?? (s.imported as AnyNode).value) as string);

/**
 * Visitor that reports every node matching one of `matchers` through `onHit`, and hands the file's imports, exports
 * and default-export roots to `onExit`.
 */
export function walkFile<T>(
  context: Rule.RuleContext,
  root: string,
  matchers: Matcher<T>[],
  onHit: (hit: Hit<T>) => void,
  onExit?: (walk: FileWalk) => void,
): Rule.RuleListener {
  const file = path.resolve(context.filename);
  const imports = new Map<string, Imported>();
  const exported = new Set<string>();
  const forbidKey = new Map<Matcher<T>, string>();
  const keyOf = (m: Matcher<T>, mod: string) => {
    let k = forbidKey.get(m);
    if (k === undefined) forbidKey.set(m, (k = moduleKey(mod, path.join(m.base, "_"), m.base)));
    return k;
  };
  const by = <K extends string>(kind: K) => matchers.filter((m) => kind in m.forbid);
  const importMs = by("import");
  const elementMs = by("element");
  const classMs = by("className").map((m) => ({ m, match: tokenMatcher((m.forbid as { className: string }).className) }));
  const callMs = by("call");
  const textMs = by("text").map((m) => ({ m, re: new RegExp((m.forbid as { text: string }).text, "i") }));

  const returns: { fn: AnyNode; expr: AnyNode | null }[] = [];
  const functions = new Map<string, AnyNode>();
  let defaultFn: AnyNode | null = null;
  let defaultName: string | null = null;
  const enclosingFn = (node: AnyNode): AnyNode | null => {
    for (let n = node.parent; n; n = n.parent) if (/Function/.test(n.type)) return n;
    return null;
  };

  const onCall = (node: AnyNode, raw: unknown) => {
    const text = calleeText(node.callee as AnyNode);
    if (!text) return;
    for (const m of callMs) {
      const call = (m.forbid as { call: string }).call;
      if (call.startsWith(".")) {
        if (text.includes(".") && text.endsWith(call)) onHit({ tag: m.tag, forbid: m.forbid, node, what: `${call.slice(1)}()` });
        continue;
      }
      if (!(text === call || text.startsWith(`${call}.`))) continue;
      // `confirm()` from a local hook is not the browser global.
      if (!call.includes(".") && isDeclaredLocally(context.sourceCode.getScope(raw as Rule.Node), text.split(".")[0]!)) continue;
      onHit({ tag: m.tag, forbid: m.forbid, node, what: describeForbid(m.forbid) });
    }
  };

  return {
    ImportDeclaration(n) {
      const node = n as unknown as AnyNode;
      const spec = (node.source as { value: unknown }).value;
      if (typeof spec !== "string") return;
      const key = moduleKey(spec, file, root);
      for (const s of node.specifiers as AnyNode[]) imports.set((s.local as AnyNode).name as string, { key, spec, name: importName(s) });
      for (const m of importMs) {
        const want = (m.forbid as { import: string }).import;
        const mod = moduleOf(want);
        if (spec !== mod && key !== keyOf(m, mod)) continue;
        if (!want.includes("#")) {
          onHit({ tag: m.tag, forbid: m.forbid, node, what: describeForbid(m.forbid) });
          continue;
        }
        const name = parseRef(want).name;
        for (const s of node.specifiers as AnyNode[]) {
          if (s.type !== "ImportNamespaceSpecifier" && importName(s) === name) onHit({ tag: m.tag, forbid: m.forbid, node: s, what: describeForbid(m.forbid) });
        }
      }
    },
    JSXOpeningElement(n: unknown) {
      const node = n as AnyNode;
      const name = jsxNameText(node.name as AnyNode);
      for (const m of elementMs) if (name === (m.forbid as { element: string }).element) onHit({ tag: m.tag, forbid: m.forbid, node, what: describeForbid(m.forbid) });
      if (!classMs.length) return;
      const tokens = (node.attributes as AnyNode[])
        .filter((a) => a.type === "JSXAttribute" && ["className", "class"].includes((a.name as AnyNode).name as string))
        .flatMap((a) => classStrings(a.value as AnyNode))
        .flatMap((s) => s.split(/\s+/))
        .filter(Boolean)
        .map((t) => t.split(":").pop()!.replace(/^!/, ""));
      for (const { m, match } of classMs) if (tokens.some(match)) onHit({ tag: m.tag, forbid: m.forbid, node, what: describeForbid(m.forbid) });
    },
    CallExpression(n) {
      onCall(n as unknown as AnyNode, n);
    },
    NewExpression(n) {
      onCall(n as unknown as AnyNode, n);
    },
    JSXText(n: unknown) {
      const node = n as AnyNode;
      const text = String(node.value).trim();
      if (!text) return;
      for (const { m, re } of textMs) if (re.test(text)) onHit({ tag: m.tag, forbid: m.forbid, node, what: `the text "${text}"` });
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
    ExportNamedDeclaration(n) {
      const node = n as unknown as AnyNode;
      const decl = node.declaration as AnyNode | null;
      if (decl?.type === "VariableDeclaration") {
        for (const d of decl.declarations as AnyNode[]) if ((d.id as AnyNode).type === "Identifier") exported.add((d.id as AnyNode).name as string);
      } else if (decl && (decl.id as AnyNode | null)) exported.add((decl.id as AnyNode).name as string);
      for (const s of (node.specifiers as AnyNode[]) ?? []) {
        const e = s.exported as AnyNode;
        exported.add((e.name ?? e.value) as string);
      }
    },
    ExportDefaultDeclaration(n) {
      exported.add("default");
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
      onExit?.({
        imports,
        exported,
        defaultRoots() {
          const fn = defaultFn ?? (defaultName ? functions.get(defaultName) : undefined);
          if (!fn) return null;
          if (fn.type === "ArrowFunctionExpression" && (fn.body as AnyNode).type !== "BlockStatement") return roots(fn.body as AnyNode);
          return returns.filter((r) => r.fn === fn).flatMap((r) => roots(r.expr));
        },
      });
    },
  } as Rule.RuleListener;
}
