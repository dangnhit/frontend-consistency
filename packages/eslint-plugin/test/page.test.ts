import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { afterAll, describe, expect, it } from "vitest";
import { routeDepth } from "../src/page.js";
import { clearContractCache, rules } from "../src/index.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.afterAll = afterAll;

const LAYOUT = path.resolve(__dirname, "../../preset-baseline/rules/layout.yaml");

function project(contract = "{}\n"): string {
  const root = mkdtempSync(path.join(tmpdir(), "fcs-page-"));
  mkdirSync(path.join(root, ".design/rules"), { recursive: true });
  writeFileSync(path.join(root, ".design/contract.yaml"), contract);
  copyFileSync(LAYOUT, path.join(root, ".design/rules/layout.yaml"));
  writeFileSync(path.join(root, "components.json"), JSON.stringify({ aliases: { ui: "@/components/ui" } }));
  return root;
}

const root = project();
const never = project("overrides:\n  layout.page-header:\n    params: { breadcrumb: never }\n");
const f = (rel: string, r = root) => path.join(r, rel);
clearContractCache();
const tester = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
  settings: { fcs: { root } },
});

const IMPORTS = `import { Page } from "@/components/fcs/page"; import { ListPage } from "@/components/fcs/list-page";`;

describe("routeDepth", () => {
  it("ignores route groups and slots", () => {
    expect(routeDepth("app/page.tsx")).toBe(0);
    expect(routeDepth("app/customers/page.tsx")).toBe(1);
    expect(routeDepth("src/app/(app)/customers/[id]/page.tsx")).toBe(2);
    expect(routeDepth("app/@modal/(group)/x/page.tsx")).toBe(1);
  });
});

tester.run("fcs/page-template", rules["page-template"], {
  valid: [
    { filename: f("app/customers/page.tsx"), code: `${IMPORTS} export default function P() { return <ListPage title="Customers"><T /></ListPage>; }` },
    {
      filename: f("app/customers/[id]/page.tsx"),
      code: `${IMPORTS} export default async function P({ params }) { const c = await get(); if (!c) notFound(); return c ? <Page title={c.name}><D /></Page> : null; }`,
    },
    { filename: f("app/settings/page.tsx"), code: `${IMPORTS} const P = () => <Page title="Settings" />; export default P;` },
    // helpers inside the page may return anything
    { filename: f("app/x/page.tsx"), code: `${IMPORTS} function Row() { return <tr />; } export default function P() { return <Page title="X"><Row /></Page>; }` },
    // not a page file
    { filename: f("components/customers-view.tsx"), code: `export default function V() { return <main />; }` },
    { filename: f("app/page.tsx"), code: `export default function P() { redirect("/customers"); }` },
  ],
  invalid: [
    {
      filename: f("app/customers/page.tsx"),
      code: `export default function P() { return <main className="mx-auto max-w-5xl"><h1>Customers</h1></main>; }`,
      errors: [{ message: /returns <main> at its root\. Return <Page> or <ListPage>.*Rule layout\.page-template/ }],
    },
    {
      filename: f("app/customers/page.tsx"),
      code: `import { CustomersView } from "./view"; export default function P() { return <CustomersView />; }`,
      errors: [{ message: /returns <CustomersView>/ }],
    },
    {
      filename: f("app/customers/page.tsx"),
      code: `${IMPORTS} export default function P() { return <><Page title="A" /></>; }`,
      errors: [{ message: /returns a fragment/ }],
    },
  ],
});

tester.run("fcs/page-header", rules["page-header"], {
  valid: [
    { filename: f("app/customers/page.tsx"), code: `${IMPORTS} <ListPage title="Customers" />` },
    {
      filename: f("app/customers/[id]/page.tsx"),
      code: `${IMPORTS} <Page title="Ann" breadcrumbs={[{ label: "Customers", href: "/customers" }, { label: "Ann" }]} />`,
    },
    { filename: f("app/(app)/customers/page.tsx"), code: `${IMPORTS} <Page title="Customers" />` },
    { filename: f("components/fcs/page.tsx"), code: `<h1>{title}</h1>` },
    { filename: f("components/ui/breadcrumb.tsx"), code: `<h1 />` },
    { filename: f("app/customers/[id]/page.tsx", never), code: `${IMPORTS} <Page title="Ann" />`, settings: { fcs: { root: never } } },
  ],
  invalid: [
    {
      filename: f("app/customers/[id]/page.tsx"),
      code: `${IMPORTS} <Page title="Ann" />`,
      errors: [{ message: /nested \(\/customers\/\[id\]\) — pass breadcrumbs=.* to <Page>\. Rule layout\.page-header \(breadcrumb = nested\)/ }],
    },
    {
      filename: f("components/customer-card.tsx"),
      code: `<h1 className="text-2xl">Ann</h1>`,
      errors: [{ message: /Don't render <h1> yourself/ }],
    },
    {
      filename: f("app/customers/page.tsx"),
      code: `import { Breadcrumb } from "@/components/ui/breadcrumb";`,
      errors: [{ message: /Don't compose shadcn Breadcrumb primitives/ }],
    },
    {
      filename: f("app/customers/[id]/page.tsx", never),
      code: `${IMPORTS} <Page title="Ann" breadcrumbs={[{ label: "Customers" }]} />`,
      settings: { fcs: { root: never } },
      errors: [{ message: /Breadcrumbs are turned off/ }],
    },
  ],
});
