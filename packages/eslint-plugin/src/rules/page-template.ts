import type { Rule } from "eslint";
import { activeContractRule, citation } from "../contract.js";
import { isFcsModule, isPageFile, isTemplateExport } from "../page.js";

const CONTRACT_RULE = "layout.page-template";

type AnyNode = { type: string; [k: string]: unknown };

function jsxName(node: AnyNode): string | undefined {
  const opening = node.openingElement as { name: AnyNode } | undefined;
  const name = opening?.name;
  if (name?.type === "JSXIdentifier") return name.name as string;
  if (name?.type === "JSXMemberExpression") return (name.property as { name: string }).name;
  return undefined;
}

/** Expressions a return can yield at the root: branches of ?: and && are each a root. */
function roots(expr: AnyNode | null | undefined): AnyNode[] {
  if (!expr) return [];
  if (expr.type === "ConditionalExpression") return [...roots(expr.consequent as AnyNode), ...roots(expr.alternate as AnyNode)];
  if (expr.type === "LogicalExpression") return roots(expr.right as AnyNode);
  if (expr.type === "AwaitExpression") return roots(expr.argument as AnyNode);
  return [expr];
}

export const pageTemplate: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Every app/**/page.tsx returns a page template from components/fcs at its root." },
    schema: [],
    messages: {
      root: "fcs/page-template: This page returns {{what}} at its root. Return <Page> or <ListPage> from @/components/fcs and put the content inside it (client views go inside the template). {{cite}}",
      contract: "fcs: cannot load design contract — {{error}}",
    },
  },
  create(context) {
    const active = activeContractRule(context, CONTRACT_RULE);
    if (active && "error" in active) {
      return {
        Program(node) {
          context.report({ node, messageId: "contract", data: { error: active.error.split("\n")[0] ?? "" } });
        },
      };
    }
    if (!active || !isPageFile(active.relPath)) return {};
    const cite = citation(active.rule);
    const templates = new Set<string>();
    const functions = new Map<string, AnyNode>();
    let pageFn: AnyNode | null = null;
    let pageName: string | null = null;
    const returns: { fn: AnyNode; expr: AnyNode | null }[] = [];

    const enclosingFn = (node: AnyNode): AnyNode | null => {
      let n = node.parent as AnyNode | undefined;
      while (n) {
        if (/Function/.test(n.type)) return n;
        n = n.parent as AnyNode | undefined;
      }
      return null;
    };

    const check = (expr: AnyNode | null, report: (what: string, node: AnyNode) => void) => {
      for (const r of roots(expr)) {
        if (r.type === "Literal" && r.value === null) continue;
        if (r.type === "JSXElement") {
          const name = jsxName(r);
          if (name && templates.has(name)) continue;
          report(name ? `<${name}>` : "an element", r);
        } else if (r.type === "JSXFragment") report("a fragment", r);
        else if (r.type === "CallExpression") continue; // notFound(), redirect(), helper returning a template
        else report("a non-template value", r);
      }
    };

    return {
      ImportDeclaration(node) {
        const src = node.source.value;
        if (typeof src !== "string" || !isFcsModule(src)) return;
        for (const s of node.specifiers) {
          if (s.type === "ImportSpecifier" && s.imported.type === "Identifier" && isTemplateExport(s.imported.name)) {
            templates.add(s.local.name);
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
        if (/Function/.test(decl.type)) pageFn = decl;
        else if (decl.type === "Identifier") pageName = decl.name as string;
      },
      ReturnStatement(n) {
        const node = n as unknown as AnyNode;
        const fn = enclosingFn(node);
        if (fn) returns.push({ fn, expr: node.argument as AnyNode | null });
      },
      "Program:exit"() {
        const fn = pageFn ?? (pageName ? functions.get(pageName) : undefined);
        if (!fn) return;
        const report = (what: string, node: AnyNode) =>
          context.report({ node: node as unknown as Rule.Node, messageId: "root", data: { what, cite } });
        if (fn.type === "ArrowFunctionExpression" && (fn.body as AnyNode).type !== "BlockStatement") {
          check(fn.body as AnyNode, report);
          return;
        }
        for (const r of returns) if (r.fn === fn) check(r.expr, report);
      },
    } as Rule.RuleListener;
  },
};
