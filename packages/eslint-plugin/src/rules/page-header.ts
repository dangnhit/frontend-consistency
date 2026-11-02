import type { Rule } from "eslint";
import { activeContractRule, citation, primitivesDir, projectRoot } from "../contract.js";
import { isFcsModule, isPageFile, isTemplateExport, routeDepth } from "../page.js";

const CONTRACT_RULE = "layout.page-header";

type AnyNode = { type: string; [k: string]: unknown };

export const pageHeader: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Page titles and breadcrumbs render only through the fcs page template." },
    schema: [],
    messages: {
      h1: "fcs/page-header: Don't render <h1> yourself. Pass the title to <Page title=…> / <ListPage title=…> from @/components/fcs. {{cite}}",
      breadcrumbImport:
        "fcs/page-header: Don't compose shadcn Breadcrumb primitives by hand. Pass breadcrumbs={[…]} to the page template. {{cite}}",
      missing:
        "fcs/page-header: This route is nested ({{route}}) — pass breadcrumbs={[{ label, href }, …, { label: <current page> }]} to <{{name}}>. {{cite}}",
      forbidden: "fcs/page-header: Breadcrumbs are turned off for this project — remove breadcrumbs from <{{name}}>. {{cite}}",
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
    const mode = String(active.rule.params.breadcrumb ?? "nested");
    const breadcrumbModule = new RegExp(`(^|/)${primitivesDir(projectRoot(context)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/breadcrumb$`);
    const page = isPageFile(active.relPath);
    const depth = page ? routeDepth(active.relPath) : 0;
    const required = page && ((mode === "nested" && depth >= 2) || (mode === "always" && depth >= 1));
    const route = `/${active.relPath.replace(/^(src\/)?app\//, "").replace(/\/?page\.\w+$/, "")}`;
    const templates = new Set<string>();

    return {
      ImportDeclaration(node) {
        const src = node.source.value;
        if (typeof src !== "string") return;
        if (breadcrumbModule.test(src)) {
          context.report({ node, messageId: "breadcrumbImport", data: { cite } });
          return;
        }
        if (!isFcsModule(src)) return;
        for (const s of node.specifiers) {
          if (s.type === "ImportSpecifier" && s.imported.type === "Identifier" && isTemplateExport(s.imported.name)) {
            templates.add(s.local.name);
          }
        }
      },
      JSXOpeningElement(n: unknown) {
        const node = n as AnyNode & Rule.Node;
        const nameNode = node.name as AnyNode;
        const name = nameNode.type === "JSXIdentifier" ? (nameNode.name as string) : undefined;
        if (!name) return;
        if (name === "h1") {
          context.report({ node, messageId: "h1", data: { cite } });
          return;
        }
        if (!page || !templates.has(name)) return;
        const attrs = node.attributes as AnyNode[];
        const has = attrs.some((a) => a.type === "JSXSpreadAttribute" || (a.name as { name?: string } | undefined)?.name === "breadcrumbs");
        if (required && !has) context.report({ node, messageId: "missing", data: { route, name, cite } });
        if (mode === "never" && has) context.report({ node, messageId: "forbidden", data: { name, cite } });
      },
    } as Rule.RuleListener;
  },
};
