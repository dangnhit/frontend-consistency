import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { clearContractCache } from "@gwinnguyen/eslint-plugin-fcs";
import { check } from "../src/commands/check.js";
import { formatScan, parseScanDecisions, scan, writeScan } from "../src/commands/scan.js";
import { readBaseline } from "../src/baseline.js";
import { readLock } from "../src/lock.js";

function write(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
}

/** An existing app that never heard of fcs: some screens share components, some hand-roll things. */
function existingApp(contract = "{}\n"): string {
  const root = mkdtempSync(path.join(tmpdir(), "fcs-scan-"));
  const page = (body: string, imports = "") => `${imports}\nexport default function P() { return ${body}; }\n`;
  const SHELL = `import { AppShell } from "@/components/layout/app-shell";`;
  const LS = `import { LoadingState } from "@/components/app/loading-state";`;
  write(root, {
    ".design/contract.yaml": contract,
    "components.json": JSON.stringify({ aliases: { ui: "@/components/ui" } }),
    "components/ui/alert-dialog.tsx": "export function AlertDialog() { return null; }\n",
    "components/app/loading-state.tsx": `import { Loader2 } from "lucide-react";\nexport function LoadingState() { return <Loader2 className="animate-spin" />; }\n`,
    "components/app/confirm-dialog.tsx": `import { AlertDialog } from "@/components/ui/alert-dialog";\nexport function ConfirmDialog() { return <AlertDialog />; }\n`,
    "components/layout/app-shell.tsx": "export function AppShell({ children }) { return <div>{children}</div>; }\n",
    "app/customers/page.tsx": page("<AppShell><LoadingState /></AppShell>", `${SHELL}\n${LS}\nimport { ConfirmDialog } from "@/components/app/confirm-dialog";`),
    "app/orders/page.tsx": page("<AppShell><LoadingState /></AppShell>", `${SHELL}\n${LS}\nimport { ConfirmDialog } from "../../components/app/confirm-dialog";`),
    "app/invoices/page.tsx": page("<AppShell><LoadingState /></AppShell>", `${SHELL}\n${LS}`),
    "app/billing/page.tsx": page('<main className="mx-auto"><Loader2 className="animate-spin" /></main>', `import { Loader2 } from "lucide-react";`),
    "components/report-table.tsx": `import { Loader2 } from "lucide-react";\nexport function ReportTable() { return <Loader2 className="size-4 animate-spin" />; }\n`,
    "components/settings-form.tsx": "export function SettingsForm({ busy }) { return busy ? <p>Loading...</p> : null; }\n",
    "components/when.tsx": "export const when = (d) => d.toLocaleDateString();\n",
    "lib/format.ts": "export const cn = (...a) => a.join(' ');\nexport function formatMoney(n) { return new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(n); }\n",
    "components/price.tsx": `import { formatMoney } from "@/lib/format";\nexport const Price = ({ n }) => <span>{formatMoney(n)}</span>;\n`,
    "components/total.tsx": `import { formatMoney, cn } from "@/lib/format";\nexport const Total = ({ n }) => <b className={cn("x")}>{formatMoney(n)}</b>;\n`,
    "components/due.tsx": "export const due = (d) => d.toLocaleDateString('en');\n",
  });
  return root;
}

beforeEach(() => {
  clearContractCache();
  process.env.FCS_ALLOW_NONINTERACTIVE = "1";
});

describe("fcs scan", () => {
  it("groups each concern into variants, promoting shared components over raw signals", async () => {
    const root = existingApp();
    const r = await scan(root);
    const by = Object.fromEntries(r.concerns.map((c) => [c.concern, c]));

    expect(by.loading!.variants.map((v) => [v.label, v.kind, v.ref ?? v.signals!.join(" + "), v.files.length])).toEqual([
      ["A", "component", "@/components/app/loading-state#LoadingState", 3],
      ["B", "raw", "Loader2 from lucide-react + the `animate-spin` class", 2],
      ["C", "raw", "text matching /^loading(\\.{3}|…)?$/i", 1],
    ]);
    expect(by.loading!.suggested).toBe("A");
    // two import styles (alias and relative) of the same file are one component
    expect(by.confirm!.variants).toHaveLength(1);
    expect(by.confirm!.variants[0]).toMatchObject({ ref: "@/components/app/confirm-dialog#ConfirmDialog", files: ["app/customers/page.tsx", "app/orders/page.tsx"] });
    expect(by["page-frame"]!.variants.map((v) => [v.ref ?? v.signals![0], v.files.length])).toEqual([
      ["@/components/layout/app-shell#AppShell", 3],
      ["<main> built in the page", 1],
    ]);
    expect(by["date-format"]!.variants).toEqual([expect.objectContaining({ kind: "raw", signals: ["toLocaleDateString()"], files: ["components/due.tsx", "components/when.tsx"] })]);
    expect(r.notFound).toEqual(expect.arrayContaining(["toast", "empty-state"]));
    // a helper in a shared module is named by the export that implements the concern, not the most imported one
    expect(by["money-format"]!.variants).toEqual([expect.objectContaining({ ref: "@/lib/format#formatMoney", files: ["components/price.tsx", "components/total.tsx"] })]);

    const text = formatScan(r);
    expect(text).toMatch(/loading — 3 variants\n {2}A {2}<LoadingState> @\/components\/app\/loading-state {2}3 file\(s\).*← suggested \(most used\)/);
    expect(text).toMatch(/confirm — 1 variant \(consistent\)\n.*← adopt as-is \(--write\)/);
    expect(text).toMatch(/→ choose: --decide loading=A\|B\|C/);
    expect(text).toMatch(/B {2}Loader2 from lucide-react \+ the `animate-spin` class {2}2 file\(s\).*app\/billing\/page\.tsx:\d+/);
  });

  it("--write adopts decisions and consistent components, locks them, and baselines the other variants", async () => {
    const root = existingApp();
    const result = await scan(root);
    const out = await writeScan(root, result, parseScanDecisions(["loading=A", "page-frame=A", "date-format=A"]));
    expect(out.written.sort()).toEqual(["confirm", "date-format", "loading", "money-format", "page-frame"]);
    expect(out.report).toMatch(/baselined \d+ existing usage\(s\) of the other variants/);

    const yaml = readFileSync(path.join(root, ".design/contract.yaml"), "utf8");
    expect(yaml).toContain('loading:\n    use: "@/components/app/loading-state#LoadingState"');
    expect(yaml).toMatch(/page-frame:\n {4}files: app\/\*\*\/page\.\{tsx,jsx,ts,js\}|page-frame:\n {4}files:\n/);
    expect(yaml).toContain("date-format:\n    forbid:");
    expect(yaml).toContain('money-format:\n    use: "@/lib/format#formatMoney"\n    lock: false');
    expect(yaml).not.toContain("call: .toLocaleDateString");
    expect(yaml).toContain("call: .toLocaleTimeString");
    expect(Object.keys(readLock(root).project).sort()).toEqual([
      "components/app/confirm-dialog.tsx",
      "components/app/loading-state.tsx",
      "components/layout/app-shell.tsx",
    ]);
    expect(Object.keys(readBaseline(root)!.files).sort()).toEqual(["app/billing/page.tsx", "components/report-table.tsx", "components/settings-form.tsx"]);

    clearContractCache();
    expect((await check(root)).errors).toBe(0);
    write(root, { "components/new-thing.tsx": `import { Loader2 } from "lucide-react";\nexport function N() { return <Loader2 />; }\n` });
    const res = await check(root);
    expect(res.errors).toBe(1);
    expect(res.report).toMatch(/fcs\/pattern\(loading\): Use <LoadingState>/);

    // scanning again shows the patterns in force and offers nothing new to adopt
    const again = await scan(root);
    expect(again.concerns.find((c) => c.concern === "loading")!.existing).toEqual(["loading"]);
    expect(formatScan(again)).toMatch(/loading — pattern "loading" in force/);
  });

  it("rejects bad decisions and raw page frames", async () => {
    const root = existingApp();
    const r = await scan(root);
    expect(() => parseScanDecisions(["loading=a"])).toThrow(/expected <concern>=<variant letter>/);
    await expect(writeScan(root, r, parseScanDecisions(["toast=A"]))).rejects.toThrow(/not found in code/);
    await expect(writeScan(root, r, parseScanDecisions(["loading=D"]))).rejects.toThrow(/variants are A, B, C/);
    await expect(writeScan(root, r, parseScanDecisions(["page-frame=B"]))).rejects.toThrow(/extract a frame component first/);
  });

  it("suggests one pattern per scope when scopes each use a single variant", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "fcs-scan-scopes-"));
    const use = (name: string, mod: string) => `import { ${name} } from "${mod}";\nexport default function P() { return <div><${name} /></div>; }\n`;
    write(root, {
      ".design/contract.yaml": 'scopes:\n  admin: { include: ["app/(admin)/**"] }\n  studio: { include: ["app/(studio)/**"] }\n',
      "components/table-skeleton.tsx": `import { Skeleton } from "@/components/ui/skeleton";\nexport function TableSkeleton() { return <Skeleton />; }\n`,
      "components/canvas-loading.tsx": `import { Loader2 } from "lucide-react";\nexport function CanvasLoading() { return <Loader2 />; }\n`,
      "app/(admin)/users/page.tsx": use("TableSkeleton", "@/components/table-skeleton"),
      "app/(admin)/roles/page.tsx": use("TableSkeleton", "@/components/table-skeleton"),
      "app/(studio)/canvas/page.tsx": use("CanvasLoading", "@/components/canvas-loading"),
      "app/(studio)/assets/page.tsx": use("CanvasLoading", "@/components/canvas-loading"),
    });
    const r = await scan(root);
    const loading = r.concerns.find((c) => c.concern === "loading")!;
    const label = (ref: string) => loading.variants.find((v) => v.ref === ref)!.label;
    const admin = label("@/components/table-skeleton#TableSkeleton");
    const studio = label("@/components/canvas-loading#CanvasLoading");
    expect(loading.splitByScope).toEqual({ admin, studio });
    expect(formatScan(r)).toContain(`each scope uses one variant: --decide loading@admin=${admin} --decide loading@studio=${studio}`);
    const out = await writeScan(root, r, parseScanDecisions([`loading@admin=${admin}`, `loading@studio=${studio}`]));
    expect(out.written.sort()).toEqual(["loading-admin", "loading-studio"]);
    const yaml = readFileSync(path.join(root, ".design/contract.yaml"), "utf8");
    expect(yaml).toMatch(/loading-admin:\n {4}concern: loading\n {4}scope: admin\n {4}use: "?@\/components\/table-skeleton#TableSkeleton"?/);
    clearContractCache();
    expect((await check(root)).errors).toBe(0);
  });

  it("derives areas from route groups when the contract has no scopes, and writes the scope it needs", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "fcs-scan-areas-"));
    const use = (name: string, mod: string) => `import { ${name} } from "${mod}";\nexport default function P() { return <div><${name} /></div>; }\n`;
    write(root, {
      ".design/contract.yaml": "{}\n",
      "components/dashboard-header.tsx": "export function DashboardHeader() { return <h1>D</h1>; }\n",
      "app/(dashboard)/a/page.tsx": use("DashboardHeader", "@/components/dashboard-header"),
      "app/(dashboard)/b/page.tsx": use("DashboardHeader", "@/components/dashboard-header"),
      "app/(marketing)/x/page.tsx": "export default function P() { return <div><h1>X</h1></div>; }\n",
      "app/(marketing)/y/page.tsx": "export default function P() { return <div><h1>Y</h1></div>; }\n",
    });
    const r = await scan(root);
    expect(r.areas).toEqual({ dashboard: ["app/(dashboard)/**"], marketing: ["app/(marketing)/**"] });
    const title = r.concerns.find((c) => c.concern === "page-title")!;
    const dash = title.variants.find((v) => v.ref === "@/components/dashboard-header#DashboardHeader")!.label;
    expect(title.splitByScope?.dashboard).toBe(dash);
    await writeScan(root, r, parseScanDecisions([`page-title@dashboard=${dash}`]));
    const yaml = readFileSync(path.join(root, ".design/contract.yaml"), "utf8");
    expect(yaml).toMatch(/scopes:\n {2}dashboard:\n {4}include:\n {6}- app\/\(dashboard\)\/\*\*/);
    clearContractCache();
    expect((await check(root)).errors).toBe(0);
    write(root, { "app/(dashboard)/c/page.tsx": "export default function P() { return <div><h1>C</h1></div>; }\n" });
    expect((await check(root)).report).toMatch(/fcs\/pattern\(page-title-dashboard\)/);
  });
});
