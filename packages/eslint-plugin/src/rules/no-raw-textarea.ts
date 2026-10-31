import type { Rule } from "eslint";
import { activeContractRule, citation } from "../contract.js";

const CONTRACT_RULE = "forms.textarea.resize";
const SHADCN_TEXTAREA = /(^|\/)components\/ui\/textarea$/;

/* Minimal JSX node shapes (ESTree types do not include JSX). */
interface JSXName {
  type: string;
  name?: string;
}
interface JSXAttr {
  type: string;
  name?: { name?: string };
  value?: { type: string; value?: unknown; expression?: { type: string; value?: unknown; quasis?: { value: { cooked: string } }[] } } | null;
}
interface JSXOpening {
  name: JSXName;
  attributes: JSXAttr[];
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

/** Resize utilities forbidden for the configured mode. `resize-none` is always fine. */
function forbiddenResize(className: string, mode: string): string | null {
  const allowed = mode === "vertical" ? new Set(["resize-y"]) : new Set<string>();
  for (const token of className.split(/\s+/)) {
    const bare = token.split(":").pop() ?? token; // strip variants like md:resize-y
    if (/^resize(-x|-y)?$/.test(bare) && !allowed.has(bare)) return token;
  }
  return null;
}

export const noRawTextarea: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Textareas must come from the locked TextareaField component; resize follows the contract." },
    schema: [],
    messages: {
      raw: "fcs/no-raw-textarea: Use <TextareaField> from @/components/fcs/textarea-field instead of {{what}}. {{cite}}",
      resize: "fcs/no-raw-textarea: Remove `{{token}}` — textarea resize is set by the contract, not per screen. {{cite}}",
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
    const { rule } = active;
    const cite = citation(rule);
    const mode = String(rule.params.resize ?? "none");
    const shadcnLocals = new Set<string>();

    return {
      ImportDeclaration(node) {
        if (typeof node.source.value !== "string" || !SHADCN_TEXTAREA.test(node.source.value)) return;
        for (const s of node.specifiers) {
          if (s.type === "ImportSpecifier" || s.type === "ImportDefaultSpecifier") shadcnLocals.add(s.local.name);
        }
      },
      JSXOpeningElement(n: unknown) {
        const node = n as JSXOpening & Rule.Node;
        const name = node.name.type === "JSXIdentifier" ? node.name.name : undefined;
        if (name === "textarea") {
          context.report({ node, messageId: "raw", data: { what: "a raw <textarea>", cite } });
        } else if (name && shadcnLocals.has(name)) {
          context.report({ node, messageId: "raw", data: { what: `the shadcn <${name}> primitive`, cite } });
        }
        for (const attr of node.attributes) {
          if (attr.type !== "JSXAttribute" || attr.name?.name !== "className") continue;
          const cls = staticClassName(attr);
          const token = cls && forbiddenResize(cls, mode);
          if (token) context.report({ node: attr as unknown as Rule.Node, messageId: "resize", data: { token, cite } });
        }
      },
    } as Rule.RuleListener;
  },
};
