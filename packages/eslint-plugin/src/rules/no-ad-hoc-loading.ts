import path from "node:path";
import type { Rule } from "eslint";
import { activeContractRule, citation, primitivesDir, projectRoot } from "../contract.js";

const CONTRACT_RULE = "loading.page";
const LUCIDE_LOADER = /^Loader(2|Circle|Pinwheel)?(Icon)?$/;
const LOADING_TEXT = /^\s*loading\s*(\.\.\.|…)?\s*$/i;

/* Minimal JSX node shapes (ESTree types do not include JSX). */
interface JSXName {
  type: string;
  name?: string;
  object?: JSXName;
  property?: JSXName;
}
interface JSXAttr {
  type: string;
  name?: { name?: string };
  value?: { type: string; value?: unknown; expression?: { type: string; value?: unknown; quasis?: { value: { cooked: string } }[] } } | null;
}
interface JSXOpening {
  name: JSXName;
  attributes: JSXAttr[];
  parent?: JSXElementNode;
}
interface JSXElementNode {
  type: string;
  openingElement?: JSXOpening;
  parent?: JSXElementNode;
}

function elementName(name: JSXName): string | undefined {
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXMemberExpression" && name.object && name.property) {
    const obj = elementName(name.object);
    return obj ? `${obj}.${name.property.name}` : undefined;
  }
  return undefined;
}

function staticClassName(attr: JSXAttr): string | null {
  const v = attr.value;
  if (!v) return null;
  if (v.type === "Literal" && typeof v.value === "string") return v.value;
  const e = v.expression;
  if (v.type === "JSXExpressionContainer" && e) {
    if (e.type === "Literal" && typeof e.value === "string") return e.value;
    if (e.type === "TemplateLiteral" && e.quasis) return e.quasis.map((q) => q.value.cooked).join(" ");
  }
  return null;
}

/** True when the element sits inside a `<…Button>` — spinners there mean an in-flight action, not page loading. */
function insideButton(opening: JSXOpening): boolean {
  let el: JSXElementNode | undefined = opening.parent?.parent;
  while (el) {
    if (el.type === "JSXElement" && el.openingElement) {
      const name = elementName(el.openingElement.name);
      if (name && (/Button$/.test(name) || name === "button")) return true;
    }
    el = el.parent;
  }
  return false;
}

export const noAdHocLoading: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Page and section loading states come from the locked AsyncBoundary / PageSkeleton components." },
    schema: [],
    messages: {
      suspense:
        "fcs/no-ad-hoc-loading: Use <AsyncBoundary skeleton=\"…\"> from @/components/fcs/async-boundary instead of a bare <Suspense>. {{cite}}",
      skeleton:
        "fcs/no-ad-hoc-loading: Use <PageSkeleton variant=\"…\"> from @/components/fcs/async-boundary instead of composing shadcn <{{name}}> by hand. {{cite}}",
      spinner:
        "fcs/no-ad-hoc-loading: {{what}} used as a loading state. Use <PageSkeleton variant=\"…\"> (or <AsyncBoundary>) — the contract decides skeleton vs spinner. Spinners are only allowed inside buttons. {{cite}}",
      text: "fcs/no-ad-hoc-loading: Replace the \"Loading…\" text with <PageSkeleton variant=\"…\">. {{cite}}",
      route:
        "fcs/no-ad-hoc-loading: loading.tsx must render <PageSkeleton variant=\"…\"> from @/components/fcs/async-boundary. {{cite}}",
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
    if (!active) return {};
    const cite = citation(active.rule);
    const skeletonModule = new RegExp(`(^|/)${primitivesDir(projectRoot(context)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/skeleton$`);
    const isRouteLoading = /^loading\.(t|j)sx?$/.test(path.basename(active.relPath)) && active.relPath.startsWith("app/");

    const suspenseLocals = new Set<string>();
    let reactNamespace: string | null = null;
    const skeletonLocals = new Set<string>();
    const loaderLocals = new Set<string>();
    let rendersPageSkeleton = false;

    return {
      ImportDeclaration(node) {
        const src = node.source.value;
        if (typeof src !== "string") return;
        for (const s of node.specifiers) {
          if (src === "react") {
            if (s.type === "ImportSpecifier" && s.imported.type === "Identifier" && s.imported.name === "Suspense") suspenseLocals.add(s.local.name);
            if (s.type === "ImportNamespaceSpecifier" || s.type === "ImportDefaultSpecifier") reactNamespace = s.local.name;
          } else if (skeletonModule.test(src)) {
            if (s.type === "ImportSpecifier" || s.type === "ImportDefaultSpecifier") skeletonLocals.add(s.local.name);
          } else if (src === "lucide-react" || src.startsWith("lucide-react/")) {
            if (s.type === "ImportSpecifier" && s.imported.type === "Identifier" && LUCIDE_LOADER.test(s.imported.name)) loaderLocals.add(s.local.name);
          }
        }
      },
      JSXOpeningElement(n: unknown) {
        const node = n as JSXOpening & Rule.Node;
        const name = elementName(node.name);
        if (!name) return;
        if (name === "PageSkeleton" || name === "AsyncBoundary") rendersPageSkeleton = true;

        if (suspenseLocals.has(name) || (reactNamespace && name === `${reactNamespace}.Suspense`)) {
          context.report({ node, messageId: "suspense", data: { cite } });
        } else if (skeletonLocals.has(name)) {
          context.report({ node, messageId: "skeleton", data: { name, cite } });
        } else if (loaderLocals.has(name) && !insideButton(node)) {
          context.report({ node, messageId: "spinner", data: { what: `<${name}>`, cite } });
          return;
        }

        for (const attr of node.attributes) {
          if (attr.type !== "JSXAttribute" || attr.name?.name !== "className") continue;
          const cls = staticClassName(attr);
          const spins = cls?.split(/\s+/).some((t) => (t.split(":").pop() ?? t) === "animate-spin");
          if (spins && !insideButton(node)) {
            context.report({ node: attr as unknown as Rule.Node, messageId: "spinner", data: { what: "`animate-spin`", cite } });
          }
        }
      },
      JSXText(n: unknown) {
        const node = n as { value: string } & Rule.Node;
        if (LOADING_TEXT.test(node.value)) context.report({ node, messageId: "text", data: { cite } });
      },
      Literal(node) {
        // {"Loading..."} inside JSX
        const parent = (node as unknown as { parent?: { type: string } }).parent;
        if (parent?.type === "JSXExpressionContainer" && typeof node.value === "string" && LOADING_TEXT.test(node.value)) {
          context.report({ node, messageId: "text", data: { cite } });
        }
      },
      "Program:exit"(node) {
        if (isRouteLoading && !rendersPageSkeleton) context.report({ node, messageId: "route", data: { cite } });
      },
    } as Rule.RuleListener;
  },
};
