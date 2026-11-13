import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ContractError,
  loadContract,
  moduleKey,
  patternsFor,
  renderRulesMarkdown,
  resolveContract,
  resolveModuleFile,
} from "../src/index.js";

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "fcs-patterns-"));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  return root;
}

const resolve = (root: string) => resolveContract(loadContract(root));
const issues = (root: string): string[] => {
  try {
    resolve(root);
    return [];
  } catch (e) {
    if (e instanceof ContractError) return e.issues.map((i) => i.message);
    throw e;
  }
};

describe("patterns: schema and defaults", () => {
  it("defaults concern to the id and forbid to catalog signals minus the canonical module", () => {
    const root = repo({
      ".design/contract.yaml": `patterns:\n  loading:\n    use: "@/components/ui/skeleton#Skeleton"\n`,
    });
    const [p] = resolve(root).patterns;
    expect(p).toMatchObject({ id: "loading", concern: "loading", severity: "error", status: "decided", lock: true, files: [] });
    expect(p!.forbid).toContainEqual({ import: "lucide-react#Loader2" });
    expect(p!.forbid).toContainEqual({ className: "animate-spin" });
    expect(p!.forbid).not.toContainEqual({ import: "@/components/ui/skeleton" });
  });

  it("rejects bad refs, root without files, and undefined scopes", () => {
    expect(issues(repo({ ".design/contract.yaml": `patterns:\n  x:\n    use: "LoadingState"\n` })).join()).toMatch(/module#Export/);
    expect(issues(repo({ ".design/contract.yaml": `patterns:\n  frame:\n    root: "@/a#A"\n` })).join()).toMatch(/`root` needs `files`/);
    expect(issues(repo({ ".design/contract.yaml": `patterns:\n  x:\n    scope: nope\n    forbid: [{ element: h1 }]\n` })).join()).toMatch(
      /undefined scope "nope"/,
    );
    expect(issues(repo({ ".design/contract.yaml": `patterns:\n  x:\n    forbid: [{ element: h1, call: x }]\n` }))).not.toEqual([]);
  });
});

describe("patterns: layered contracts", () => {
  const files = {
    ".design/contract.yaml": `patterns:\n  confirm:\n    use: "@acme/ui#ConfirmDialog"\n  loading:\n    use: "@acme/ui#Spinner"\n`,
    "apps/studio/.design/contract.yaml": `extends: ../../../.design\npatterns:\n  loading:\n    use: "@/components/canvas-loading#CanvasLoading"\n    reason: Canvases need progress.\n`,
    "apps/admin/.design/contract.yaml": `extends: ../../../.design\npatterns:\n  loading:\n    use: "@/components/table-skeleton#TableSkeleton"\n`,
  };

  it("inherits parent patterns, keeps their base, and lets a child override with a reason", () => {
    const root = repo(files);
    const studio = path.join(root, "apps/studio");
    const r = resolve(studio);
    const byId = Object.fromEntries(r.patterns.map((p) => [p.id, p]));
    expect(byId.confirm).toMatchObject({ base: root, origin: "../../.design/contract.yaml", depth: 0 });
    expect(byId.loading).toMatchObject({ use: ["@/components/canvas-loading#CanvasLoading"], base: studio, depth: 1 });
  });

  it("requires a reason to override a parent pattern", () => {
    const root = repo(files);
    expect(issues(path.join(root, "apps/admin")).join()).toMatch(/pattern "loading" overrides the one in .*add `reason:`/);
  });

  it("detects extends cycles", () => {
    const root = repo({
      "a/.design/contract.yaml": "extends: ../../b/.design\n",
      "b/.design/contract.yaml": "extends: ../../a/.design\n",
    });
    expect(issues(path.join(root, "a")).join()).toMatch(/cycle/);
  });
});

describe("patternsFor", () => {
  it("picks the most specific pattern per concern and evaluates globs from the declaring contract", () => {
    const root = repo({
      ".design/contract.yaml": `patterns:
  page-frame:
    files: "apps/*/app/**/page.tsx"
    root: "@acme/ui#BasePage"
`,
      "apps/admin/.design/contract.yaml": `extends: ../../../.design
scopes:
  reports: { include: ["app/reports/**"] }
patterns:
  admin-frame:
    concern: page-frame
    files: "app/**/page.tsx"
    root: "@/a#AdminPage"
  report-frame:
    concern: page-frame
    scope: reports
    files: "app/**/page.tsx"
    root: "@/r#ReportPage"
  notes:
    forbid: [{ element: textarea }]
    except: [{ path: "app/legacy/**", reason: "migrating" }]
`,
    });
    const admin = path.join(root, "apps/admin");
    const ps = resolve(admin).patterns;
    const ids = (rel: string) => patternsFor(ps, path.join(admin, rel)).map((p) => p.id).sort();
    expect(ids("app/users/page.tsx")).toEqual(["admin-frame", "notes"]);
    expect(ids("app/reports/q1/page.tsx")).toEqual(["notes", "report-frame"]);
    expect(ids("app/legacy/page.tsx")).toEqual(["admin-frame"]);
    expect(ids("components/x.tsx")).toEqual(["notes"]);
    // the root pattern's glob is relative to the repo root, so it matches the studio app too
    expect(patternsFor(ps, path.join(root, "apps/studio/app/x/page.tsx")).map((p) => p.id)).toEqual(["page-frame"]);
  });
});

describe("module resolution", () => {
  it("resolves tsconfig paths (with comments) and relative specifiers to the same key", () => {
    const root = repo({
      "tsconfig.json": `{ /* c */ "compilerOptions": { "baseUrl": ".", "paths": { "~/*": ["./src/*"] }, }, }`,
      "src/components/x/index.tsx": "export {}",
    });
    const from = path.join(root, "src/app/page.tsx");
    expect(resolveModuleFile("~/components/x", from, root)).toBe(path.join(root, "src/components/x/index.tsx"));
    expect(moduleKey("~/components/x", from, root)).toBe(moduleKey("../components/x", from, root));
    expect(moduleKey("lucide-react", from, root)).toBe("lucide-react");
  });
});

describe("agent context", () => {
  it("lists one line per pattern with the project's names", () => {
    const root = repo({
      ".design/contract.yaml": `patterns:
  loading:
    use: "@/components/app/loading-state#LoadingState"
    forbid: [{ import: "lucide-react#Loader2" }, { className: animate-spin }]
    why: One loading look.
  page-frame:
    files: "app/**/page.tsx"
    root: ["@/components/layout/app-page#AppPage"]
  confirm:
    use: "@/components/app/confirm-dialog#ConfirmDialog"
    status: proposed
`,
    });
    const md = renderRulesMarkdown(resolve(root));
    expect(md).toContain("### Project patterns");
    expect(md).toContain(
      "- **Loading states** (`loading`) → use `<LoadingState>` (`@/components/app/loading-state`). Never: `lucide-react → Loader2`, class `animate-spin`. _One loading look._",
    );
    expect(md).toContain("- **Page frame** (`page-frame`, `app/**/page.tsx`) → the default export returns `<AppPage>` (`@/components/layout/app-page`) at its root.");
    expect(md).toMatch(/Confirmations.*\[proposed — awaiting team confirmation, still enforced\]/);
  });
});
