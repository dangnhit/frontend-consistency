import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { afterAll, describe, it } from "vitest";
import { clearContractCache, rules } from "../src/index.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.afterAll = afterAll;

function write(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
}

function project(contract: string, files: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), "fcs-pattern-"));
  write(root, {
    ".design/contract.yaml": contract,
    "components.json": JSON.stringify({ aliases: { ui: "@/components/ui" } }),
    "tsconfig.json": '{\n  // Next.js default\n  "compilerOptions": { "paths": { "@/*": ["./*"] }, },\n}\n',
    ...files,
  });
  return root;
}

/** A project with its own components — none of them from fcs. */
const app = project(
  `patterns:
  loading:
    use: "@/components/app/loading-state#LoadingState"
    why: One loading look.
  text-input:
    use: "@/components/app/note-input#NoteInput"
    forbid:
      - element: textarea
  confirm:
    use: "@/components/app/confirm-dialog#ConfirmDialog"
    status: proposed
  page-frame:
    files: "app/**/page.tsx"
    root: ["@/components/layout/app-page#AppPage", "@/components/layout/editor-shell#EditorShell"]
  money:
    concern: money-format
    forbid:
      - call: .toFixed
      - className: "/^text-\\\\[#/"
    severity: warn
`,
  {
    "components/app/loading-state.tsx": `import { Loader2 } from "lucide-react"; export function LoadingState() { return <Loader2 className="animate-spin" />; }`,
    "components/app/note-input.tsx": `export function NoteInput() { return <textarea />; }`,
    "components/app/confirm-dialog.tsx": `export function ConfirmDialog() { return null; }`,
    "components/layout/app-page.tsx": `export function AppPage({ children }) { return <main>{children}</main>; }`,
    "components/layout/editor-shell.tsx": `export function EditorShell({ children }) { return <div>{children}</div>; }`,
  },
);
const f = (rel: string, root = app) => path.join(root, rel);

clearContractCache();
const tester = (root: string) =>
  new RuleTester({
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { fcs: { root } },
  });

const PAGE = `import { AppPage } from "@/components/layout/app-page";`;

tester(app).run("fcs/pattern (project components)", rules.pattern, {
  valid: [
    { filename: f("app/x/page.tsx"), code: `${PAGE} import { LoadingState } from "@/components/app/loading-state"; export default function P() { return <AppPage><LoadingState /></AppPage>; }` },
    // relative import of the canonical frame
    { filename: f("app/x/page.tsx"), code: `import { EditorShell } from "../../components/layout/editor-shell"; export default () => <EditorShell />;` },
    // canonical components may use what their pattern forbids
    { filename: f("components/app/loading-state.tsx"), code: `import { Loader2 } from "lucide-react"; export function LoadingState() { return <Loader2 className="animate-spin" />; }` },
    { filename: f("components/app/note-input.tsx"), code: `export function NoteInput() { return <textarea />; }` },
    // primitives are exempt
    { filename: f("components/ui/textarea.tsx"), code: `export function Textarea() { return <textarea />; }` },
    // a local confirm() is not the browser global
    { filename: f("components/x.tsx"), code: `export function X() { const { confirm } = useConfirm(); confirm(); return null; }` },
    // root rule only applies to files matching `files`
    { filename: f("components/view.tsx"), code: `export default function V() { return <main />; }` },
    // notFound()/redirect() and null roots are fine
    { filename: f("app/y/page.tsx"), code: `${PAGE} export default async function P() { const d = await get(); if (!d) return notFound(); return d ? <AppPage /> : null; }` },
    // warn-severity patterns are reported by fcs/pattern-warn, not here
    { filename: f("components/price.tsx"), code: `export const p = (n) => n.toFixed(2);` },
  ],
  invalid: [
    {
      filename: f("app/a/page.tsx"),
      code: `${PAGE} import { Loader2 } from "lucide-react"; export default function P() { return <AppPage><Loader2 className="size-4 animate-spin" /></AppPage>; }`,
      errors: [
        { message: /^fcs\/pattern\(loading\): Use <LoadingState> from @\/components\/app\/loading-state instead of Loader2 from lucide-react\. One loading look\. — pattern "loading" in \.design\/contract\.yaml$/ },
        { message: /instead of the `animate-spin` class/ },
      ],
    },
    {
      filename: f("components/b.tsx"),
      code: `import { Skeleton } from "@/components/ui/skeleton"; export function B({ busy }) { return busy ? <p>Loading...</p> : <div className={cn("p-4", busy && "animate-spin")} />; }`,
      errors: [{ message: /instead of @\/components\/ui\/skeleton/ }, { message: /instead of the text "Loading\.\.\."/ }, { message: /animate-spin/ }],
    },
    {
      filename: f("components/c.tsx"),
      code: `export function C() { return <textarea className="md:resize-y" />; }`,
      errors: [{ message: /^fcs\/pattern\(text-input\): Use <NoteInput> from @\/components\/app\/note-input instead of a raw <textarea>/ }],
    },
    {
      filename: f("components/d.tsx"),
      code: `export function D() { if (window.confirm("Delete?")) remove(); if (confirm("Sure?")) go(); return null; }`,
      errors: [{ message: /\(confirm\): Use <ConfirmDialog>.*window\.confirm\(\).*\[proposed\]$/ }, { message: /instead of confirm\(\)/ }],
    },
    {
      filename: f("app/e/page.tsx"),
      code: `export default function P() { return <main className="mx-auto max-w-5xl"><h1>E</h1></main>; }`,
      errors: [{ message: /^fcs\/pattern\(page-frame\): The default export returns <main> at its root\. Return <AppPage> from @\/components\/layout\/app-page or <EditorShell> from @\/components\/layout\/editor-shell/ }],
    },
    {
      filename: f("app/f/page.tsx"),
      code: `import { AppPage } from "@/components/layout/other"; const P = () => <><AppPage /></>; export default P;`,
      errors: [{ message: /returns a fragment/ }],
    },
    {
      // same export name from a different module is not the canonical one
      filename: f("app/g/page.tsx"),
      code: `import { AppPage } from "@/components/legacy/app-page"; export default function P() { return <AppPage />; }`,
      errors: [{ message: /returns <AppPage> at its root/ }],
    },
  ],
});

tester(app).run("fcs/pattern-warn", rules["pattern-warn"], {
  valid: [{ filename: f("components/price.tsx"), code: `export const p = (n) => format(n);` }],
  invalid: [
    {
      filename: f("components/price.tsx"),
      code: `export const P = ({ n }) => <span className="text-[#3b82f6]">{n.toFixed(2)}</span>;`,
      errors: [{ message: /^fcs\/pattern-warn\(money\): Do not use the `\/\^text-\\\[#\/` class/ }, { message: /Do not use toFixed\(\)/ }],
    },
  ],
});

/** Two apps in one repo: shared patterns at the root, a different page frame per app. */
const repo = mkdtempSync(path.join(tmpdir(), "fcs-repo-"));
write(repo, {
  ".design/contract.yaml": `patterns:
  confirm:
    use: "@acme/ui#ConfirmDialog"
  page-frame:
    files: "apps/*/app/**/page.tsx"
    root: ["@acme/ui#BasePage"]
`,
  "apps/admin/.design/contract.yaml": `extends: ../../../.design
scopes:
  reports: { include: ["app/reports/**"] }
patterns:
  page-frame:
    files: "app/**/page.tsx"
    root: ["@/components/admin-page#AdminPage"]
    reason: Admin pages carry the sidebar.
  report-frame:
    concern: page-frame
    scope: reports
    files: "app/**/page.tsx"
    root: ["@/components/report-page#ReportPage"]
`,
  "apps/studio/.design/contract.yaml": `extends: ../../../.design
patterns:
  page-frame:
    files: "app/**/page.tsx"
    root: ["@/components/studio-shell#StudioShell"]
    reason: Studio is a full-screen canvas.
`,
});
const admin = path.join(repo, "apps/admin");
const studio = path.join(repo, "apps/studio");
clearContractCache();

tester(admin).run("fcs/pattern (admin app)", rules.pattern, {
  valid: [
    { filename: f("app/users/page.tsx", admin), code: `import { AdminPage } from "@/components/admin-page"; export default () => <AdminPage />;` },
    // the more specific (scoped) pattern wins for reports
    { filename: f("app/reports/q1/page.tsx", admin), code: `import { ReportPage } from "@/components/report-page"; export default () => <ReportPage />;` },
  ],
  invalid: [
    {
      filename: f("app/users/page.tsx", admin),
      code: `import { StudioShell } from "@/components/studio-shell"; export default () => <StudioShell />;`,
      errors: [{ message: /Return <AdminPage> from @\/components\/admin-page/ }],
    },
    {
      filename: f("app/reports/q1/page.tsx", admin),
      code: `import { AdminPage } from "@/components/admin-page"; export default () => <AdminPage />;`,
      errors: [{ message: /Return <ReportPage>/ }],
    },
    {
      // inherited from the root contract, cited there
      filename: f("components/x.tsx", admin),
      code: `export function X() { window.confirm("?"); return null; }`,
      errors: [{ message: /Use <ConfirmDialog> from @acme\/ui.*pattern "confirm" in \.\.\/\.\.\/\.design\/contract\.yaml$/ }],
    },
  ],
});

tester(studio).run("fcs/pattern (studio app)", rules.pattern, {
  valid: [{ filename: f("app/canvas/page.tsx", studio), code: `import { StudioShell } from "@/components/studio-shell"; export default () => <StudioShell />;` }],
  invalid: [
    {
      filename: f("app/canvas/page.tsx", studio),
      code: `import { AdminPage } from "@/components/admin-page"; export default () => <AdminPage />;`,
      errors: [{ message: /Return <StudioShell>/ }],
    },
  ],
});
