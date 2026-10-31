import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Linter, RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { afterAll, describe, expect, it } from "vitest";
import { clearContractCache, rules } from "../src/index.js";
import plugin from "../src/index.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.afterAll = afterAll;

function project(rulesYaml: string, contract = "{}\n"): string {
  const root = mkdtempSync(path.join(tmpdir(), "fcs-eslint-"));
  mkdirSync(path.join(root, ".design/rules"), { recursive: true });
  writeFileSync(path.join(root, ".design/contract.yaml"), contract);
  writeFileSync(path.join(root, ".design/rules/forms.yaml"), rulesYaml);
  return root;
}

const RULE = (extra = "") => `
- id: forms.textarea.resize
  title: Textareas are not user-resizable
  why: w
  params: { resize: none }
  enforce: { component: "@fcs/textarea-field", lint: [fcs/no-raw-textarea] }
${extra}`;

function tester(root: string) {
  clearContractCache();
  return new RuleTester({
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { fcs: { root } },
  });
}

const none = project(RULE());
const f = (rel: string) => path.join(none, rel);

tester(none).run("fcs/no-raw-textarea (resize none)", rules["no-raw-textarea"], {
  valid: [
    { filename: f("app/page.tsx"), code: `<TextareaField label="Note" name="n" />` },
    { filename: f("app/page.tsx"), code: `<TextareaField label="Note" name="n" className="resize-none" />` },
    { filename: f("components/fcs/textarea-field.tsx"), code: `import { Textarea } from "@/components/ui/textarea"; <Textarea className="resize-none" />` },
    { filename: f("components/ui/textarea.tsx"), code: `<textarea className="flex" />` },
  ],
  invalid: [
    {
      filename: f("app/page.tsx"),
      code: `<textarea />`,
      errors: [{ message: /Use <TextareaField> .* instead of a raw <textarea>\. Rule forms\.textarea\.resize \(resize = none\) — \.design\/rules\/forms\.yaml/ }],
    },
    {
      filename: f("app/page.tsx"),
      code: `import { Textarea } from "@/components/ui/textarea"; <Textarea />`,
      errors: [{ message: /instead of the shadcn <Textarea> primitive/ }],
    },
    {
      filename: f("app/page.tsx"),
      code: `<TextareaField label="a" name="a" className="mt-2 md:resize-y" />`,
      errors: [{ message: /Remove `md:resize-y`/ }],
    },
    {
      filename: f("app/page.tsx"),
      code: "<TextareaField label='a' name='a' className={`resize ${x}`} />",
      errors: [{ message: /Remove `resize`/ }],
    },
  ],
});

const vertical = project(RULE(), "overrides:\n  forms.textarea.resize: { params: { resize: vertical } }\n");
tester(vertical).run("fcs/no-raw-textarea (resize vertical)", rules["no-raw-textarea"], {
  valid: [{ filename: path.join(vertical, "app/page.tsx"), code: `<TextareaField label="a" name="a" className="resize-y" />` }],
  invalid: [
    {
      filename: path.join(vertical, "app/page.tsx"),
      code: `<TextareaField label="a" name="a" className="resize-x" />`,
      errors: [{ message: /Remove `resize-x`/ }],
    },
  ],
});

const excepted = project(
  RULE(`  exceptions:\n    - { path: "app/(app)/notes/editor/**", reason: long-form editor }`),
);
tester(excepted).run("fcs/no-raw-textarea (exceptions)", rules["no-raw-textarea"], {
  valid: [{ filename: path.join(excepted, "app/(app)/notes/editor/page.tsx"), code: `<textarea />` }],
  invalid: [{ filename: path.join(excepted, "app/(app)/notes/page.tsx"), code: `<textarea />`, errors: 1 }],
});

const broken = mkdtempSync(path.join(tmpdir(), "fcs-eslint-broken-"));
tester(broken).run("fcs/no-raw-textarea (missing contract)", rules["no-raw-textarea"], {
  valid: [],
  invalid: [{ filename: path.join(broken, "app/page.tsx"), code: `<div />`, errors: [{ message: /cannot load design contract/ }] }],
});

// Inline directives would suppress the very report under test, so lint with inline config off
// (exactly what `fcs check` does) and look only at this rule's messages.
describe("fcs/no-disable", () => {
  const lint = (code: string) =>
    new Linter({ configType: "flat" })
      .verify(code, {
        plugins: { fcs: plugin },
        languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
        linterOptions: { noInlineConfig: true, reportUnusedInlineConfigs: "off" },
        rules: { "fcs/no-disable": "error" },
      })
      .filter((m) => m.ruleId === "fcs/no-disable")
      .map((m) => m.message);

  it("ignores unrelated disables", () => expect(lint("// eslint-disable-next-line no-console\nconsole.log(1)")).toEqual([]));
  it("flags targeted fcs disables", () =>
    expect(lint("// eslint-disable-next-line fcs/no-raw-textarea\n<textarea />")[0]).toMatch(/Do not disable fcs rules/));
  it("flags blanket disables", () => expect(lint("/* eslint-disable */")[0]).toMatch(/all lint rules/));
});

describe("config()", () => {
  it("takes severity from the contract", () => {
    clearContractCache();
    const root = project(RULE(), "overrides:\n  forms.textarea.resize: { severity: warn }\n");
    const [cfg] = plugin.config({ root });
    expect(cfg!.rules!["fcs/no-raw-textarea"]).toBe("warn");
    expect(cfg!.rules!["fcs/no-disable"]).toBe("error");
  });
});
