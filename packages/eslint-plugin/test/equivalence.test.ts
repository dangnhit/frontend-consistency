import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";
import fcs, { clearContractCache } from "../src/index.js";

/**
 * v0.2 claim: the v1 baseline rules are expressible as project patterns. Every snippet the v1 rules reject must also
 * be rejected by `fcs/pattern` with the equivalent patterns, and the sanctioned code must pass both.
 */
const PRESET_RULES = path.resolve(__dirname, "../../preset-baseline/rules");

const root = mkdtempSync(path.join(tmpdir(), "fcs-equiv-"));
cpSync(PRESET_RULES, path.join(root, "preset/rules"), { recursive: true });
mkdirSync(path.join(root, ".design"), { recursive: true });
writeFileSync(path.join(root, "components.json"), JSON.stringify({ aliases: { ui: "@/components/ui" } }));
writeFileSync(
  path.join(root, ".design/contract.yaml"),
  `extends: ../preset
patterns:
  text-input:
    use: "@/components/fcs/textarea-field#TextareaField"
    forbid:
      - element: textarea
      - import: "@/components/ui/textarea"
      - className: "/^resize(-x|-y)?$/"
  loading:
    use: "@/components/fcs/async-boundary#AsyncBoundary"
  page-title:
    forbid:
      - element: h1
      - import: "@/components/ui/breadcrumb"
  page-frame:
    files: "app/**/page.tsx"
    root: ["@/components/fcs/page#Page", "@/components/fcs/list-page#ListPage"]
`,
);
clearContractCache();

const [cfg] = fcs.config({ root });
const run = (rules: Record<string, Linter.RuleSeverity>, rel: string, code: string) =>
  new Linter({ cwd: root }).verify(code, { ...cfg!, files: ["**/*.tsx"], rules }, { filename: path.join(root, rel) }).map((m) => m.ruleId);

const V1 = {
  "fcs/no-raw-textarea": "error",
  "fcs/no-ad-hoc-loading": "error",
  "fcs/page-template": "error",
  "fcs/page-header": "error",
} as const;
const V2 = { "fcs/pattern": "error" } as const;

const PAGE = `import { Page } from "@/components/fcs/page";`;

const rejected: [string, string, string][] = [
  ["raw textarea", "components/notes.tsx", `export function N() { return <textarea />; }`],
  ["shadcn Textarea primitive", "components/notes.tsx", `import { Textarea } from "@/components/ui/textarea"; export function N() { return <Textarea />; }`],
  ["resize class", "components/notes.tsx", `import { TextareaField } from "@/components/fcs/textarea-field"; export function N() { return <TextareaField className="resize-y" />; }`],
  ["spinner icon", "components/list.tsx", `import { Loader2 } from "lucide-react"; export function L() { return <Loader2 className="animate-spin" />; }`],
  ["hand-made skeleton", "components/list.tsx", `import { Skeleton } from "@/components/ui/skeleton"; export function L() { return <Skeleton />; }`],
  ["h1 in a page", "app/x/page.tsx", `${PAGE} export default function P() { return <Page title="X"><h1>X</h1></Page>; }`],
  ["hand-built breadcrumb", "app/x/page.tsx", `${PAGE} import { Breadcrumb } from "@/components/ui/breadcrumb"; export default function P() { return <Page title="X" />; }`],
  ["page without the template", "app/x/page.tsx", `export default function P() { return <main className="mx-auto max-w-5xl" />; }`],
];

const accepted: [string, string, string][] = [
  ["template page", "app/x/page.tsx", `${PAGE} import { AsyncBoundary } from "@/components/fcs/async-boundary"; export default function P() { return <Page title="X"><AsyncBoundary skeleton="list"><L /></AsyncBoundary></Page>; }`],
  ["field", "components/notes.tsx", `import { TextareaField } from "@/components/fcs/textarea-field"; export function N() { return <TextareaField label="Body" />; }`],
];

describe("v1 baseline rules ⇔ patterns", () => {
  for (const [name, rel, code] of rejected) {
    it(`both reject: ${name}`, () => {
      expect(run(V1, rel, code).length, "v1").toBeGreaterThan(0);
      expect(run(V2, rel, code), "patterns").toContain("fcs/pattern");
    });
  }
  for (const [name, rel, code] of accepted) {
    it(`both accept: ${name}`, () => {
      expect(run(V1, rel, code)).toEqual([]);
      expect(run(V2, rel, code)).toEqual([]);
    });
  }
});
