import type { Rule } from "eslint";

const DIRECTIVE = /^\s*eslint-disable(-next-line|-line)?\b(.*)$/s;

/**
 * Flags inline directives that disable fcs rules (explicitly, or by disabling all rules).
 * Limitation: a blanket `eslint-disable` also silences this rule inside the editor; `fcs check` lints with
 * inline config off, so such directives never hide violations there.
 */
export const noDisable: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow disabling fcs rules with inline comments." },
    schema: [],
    messages: {
      disable:
        "fcs/no-disable: Do not disable {{target}}. Fix the code, or change the rule in .design/ (scope, exception or override) with a reason.",
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const m = DIRECTIVE.exec(comment.value);
          if (!m) continue;
          const rules = (m[2] ?? "").split("--")[0]!.trim();
          const target = rules === "" ? "all lint rules (this includes fcs rules)" : rules.includes("fcs/") ? "fcs rules" : null;
          if (target) context.report({ loc: comment.loc!, messageId: "disable", data: { target } });
        }
      },
    };
  },
};
