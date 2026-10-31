import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ContractError, loadContract, resolveContract, ruleAppliesTo, getRule } from "../src/index.js";

const TEXTAREA_RULE = `
- id: forms.textarea.resize
  title: Textareas are not user-resizable
  why: Resize handles break alignment.
  params: { resize: none }
  enforce: { component: "@fcs/textarea-field", lint: [fcs/no-raw-textarea] }
`;

function project(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "fcs-core-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const resolve = (root: string) => resolveContract(loadContract(root));

function issuesOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof ContractError) return e.issues.map((i) => i.message);
    throw e;
  }
  throw new Error("expected ContractError");
}

describe("resolveContract", () => {
  it("loads preset rules via relative extends", () => {
    const root = project({
      ".design/contract.yaml": "extends: ../preset\n",
      "preset/rules/forms.yaml": TEXTAREA_RULE,
    });
    const r = getRule(resolve(root), "forms.textarea.resize")!;
    expect(r.severity).toBe("error");
    expect(r.params).toEqual({ resize: "none" });
    expect(r.origin).toBe("preset/rules/forms.yaml");
  });

  it("contract overrides merge params and win over preset", () => {
    const root = project({
      ".design/contract.yaml": `
extends: ../preset
overrides:
  forms.textarea.resize: { severity: warn, params: { resize: vertical } }
`,
      "preset/rules/forms.yaml": TEXTAREA_RULE,
    });
    const r = getRule(resolve(root), "forms.textarea.resize")!;
    expect(r.severity).toBe("warn");
    expect(r.params.resize).toBe("vertical");
    expect(r.title).toBe("Textareas are not user-resizable");
    expect(r.origin).toBe(".design/contract.yaml");
  });

  it("project rule with same id redefines preset rule", () => {
    const root = project({
      ".design/contract.yaml": "extends: ../preset\n",
      "preset/rules/forms.yaml": TEXTAREA_RULE,
      ".design/rules/forms.yaml": `
- id: forms.textarea.resize
  title: Textareas resize vertically only
  why: Client request.
  params: { resize: vertical }
`,
    });
    const r = getRule(resolve(root), "forms.textarea.resize")!;
    expect(r.title).toBe("Textareas resize vertically only");
    expect(r.params.resize).toBe("vertical");
  });

  it("rejects override of unknown rule", () => {
    const root = project({ ".design/contract.yaml": "overrides:\n  forms.nope.x: { severity: off }\n" });
    expect(issuesOf(() => resolve(root))).toContain('override targets unknown rule "forms.nope.x"');
  });

  it("rejects duplicate ids within one layer", () => {
    const root = project({
      ".design/contract.yaml": "{}\n",
      ".design/rules/a.yaml": TEXTAREA_RULE,
      ".design/rules/b.yaml": TEXTAREA_RULE,
    });
    expect(issuesOf(() => resolve(root)).join()).toMatch(/duplicate rule id "forms.textarea.resize"/);
  });

  it("rejects undefined scope and active superseded rule", () => {
    const root = project({
      ".design/contract.yaml": "{}\n",
      ".design/rules/a.yaml": `${TEXTAREA_RULE}
- id: forms.textarea.autosize
  title: Textareas autosize
  why: Replaces manual resize.
  scope: app
  supersedes: [forms.textarea.resize]
`,
    });
    const issues = issuesOf(() => resolve(root)).join("\n");
    expect(issues).toMatch(/undefined scope "app"/);
    expect(issues).toMatch(/supersedes "forms.textarea.resize", but .* still active/);
  });

  it("reports schema errors with file path", () => {
    const root = project({
      ".design/contract.yaml": "{}\n",
      ".design/rules/bad.yaml": "- id: NotDotted\n  title: x\n  why: y\n",
    });
    expect(issuesOf(() => resolve(root)).join()).toMatch(/dotted lowercase/);
  });

  it("reports missing contract", () => {
    const root = project({});
    expect(issuesOf(() => resolve(root)).join()).toMatch(/missing/);
  });
});

describe("ruleAppliesTo", () => {
  const root = project({
    ".design/contract.yaml": `
scopes:
  app: { include: ["app/(app)/**"], exclude: ["app/(app)/legacy/**"] }
`,
    ".design/rules/forms.yaml": `
- id: forms.textarea.resize
  title: t
  why: w
  scope: app
  exceptions:
    - { path: "app/(app)/notes/editor/**", reason: long-form editor }
`,
  });
  const resolved = resolve(root);
  const rule = getRule(resolved, "forms.textarea.resize")!;
  const applies = (p: string) => ruleAppliesTo(rule, p, resolved.scopes);

  it("matches in scope", () => expect(applies("app/(app)/settings/page.tsx")).toBe(true));
  it("skips out of scope", () => expect(applies("app/(marketing)/page.tsx")).toBe(false));
  it("honours scope exclude", () => expect(applies("app/(app)/legacy/x.tsx")).toBe(false));
  it("honours exceptions", () => expect(applies("app/(app)/notes/editor/page.tsx")).toBe(false));
  it("off rules never apply", () =>
    expect(ruleAppliesTo({ ...rule, severity: "off" }, "app/(app)/a.tsx", resolved.scopes)).toBe(false));
});
