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

function project(): string {
  const root = mkdtempSync(path.join(tmpdir(), "fcs-loading-"));
  mkdirSync(path.join(root, ".design/rules"), { recursive: true });
  writeFileSync(path.join(root, ".design/contract.yaml"), "{}\n");
  writeFileSync(
    path.join(root, ".design/rules/loading.yaml"),
    `- id: loading.page
  title: t
  why: w
  params: { pattern: skeleton, delayMs: 300 }
  enforce: { component: "@fcs/async-boundary", lint: [fcs/no-ad-hoc-loading] }
`,
  );
  writeFileSync(path.join(root, "components.json"), JSON.stringify({ aliases: { ui: "@/components/ui" } }));
  return root;
}

const root = project();
const f = (rel: string) => path.join(root, rel);
clearContractCache();
const tester = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
  settings: { fcs: { root } },
});

tester.run("fcs/no-ad-hoc-loading", rules["no-ad-hoc-loading"], {
  valid: [
    { filename: f("app/page.tsx"), code: `<AsyncBoundary skeleton="list"><Table /></AsyncBoundary>` },
    { filename: f("app/page.tsx"), code: `if (isLoading) return <PageSkeleton variant="detail" />;` },
    { filename: f("app/customers/loading.tsx"), code: `export default function L() { return <PageSkeleton variant="list" />; }` },
    // spinner for an in-flight action
    {
      filename: f("app/page.tsx"),
      code: `import { Loader2 } from "lucide-react"; <Button disabled><Loader2 className="animate-spin" /> Saving</Button>`,
    },
    { filename: f("app/page.tsx"), code: `<SubmitButton><span className="animate-spin" /></SubmitButton>` },
    // locked component and primitives are where the sanctioned implementation lives
    { filename: f("components/fcs/async-boundary.tsx"), code: `import { Suspense } from "react"; <Suspense fallback={null} />` },
    { filename: f("components/ui/skeleton.tsx"), code: `<div className="animate-pulse" />` },
    { filename: f("app/page.tsx"), code: `<p>Loading your invoices is fast</p>` },
  ],
  invalid: [
    {
      filename: f("app/page.tsx"),
      code: `import { Suspense } from "react"; <Suspense fallback={null}><X /></Suspense>`,
      errors: [{ message: /Use <AsyncBoundary skeleton="…"> .* bare <Suspense>\. Rule loading\.page \(pattern = skeleton, delayMs = 300\)/ }],
    },
    {
      filename: f("app/page.tsx"),
      code: `import * as React from "react"; <React.Suspense fallback={null} />`,
      errors: [{ message: /bare <Suspense>/ }],
    },
    {
      filename: f("app/page.tsx"),
      code: `import { Skeleton } from "@/components/ui/skeleton"; <Skeleton className="h-4" />`,
      errors: [{ message: /instead of composing shadcn <Skeleton> by hand/ }],
    },
    {
      filename: f("app/page.tsx"),
      code: `import { Loader2 } from "lucide-react"; if (isLoading) return <Loader2 className="animate-spin" />;`,
      errors: [{ message: /<Loader2> used as a loading state/ }],
    },
    {
      filename: f("app/page.tsx"),
      code: `if (isLoading) return <div className="mx-auto md:animate-spin rounded-full border-2" />;`,
      errors: [{ message: /`animate-spin` used as a loading state/ }],
    },
    { filename: f("app/page.tsx"), code: `if (isLoading) return <p>Loading...</p>;`, errors: [{ message: /Replace the "Loading…" text/ }] },
    { filename: f("app/page.tsx"), code: `<div>{"Loading…"}</div>`, errors: [{ message: /Replace the "Loading…" text/ }] },
    {
      filename: f("app/customers/loading.tsx"),
      code: `export default function L() { return <div className="p-4" />; }`,
      errors: [{ message: /loading\.tsx must render <PageSkeleton/ }],
    },
  ],
});
