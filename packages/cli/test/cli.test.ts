import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { clearContractCache } from "@gwinnguyen/eslint-plugin-fcs";
import { build } from "../src/commands/build.js";
import { check } from "../src/commands/check.js";
import { findRoot, hookPost, hookPre, hookStop, patchFiles } from "../src/commands/hook.js";
import { importDesignDoc } from "../src/commands/import.js";
import { init } from "../src/commands/init.js";
import { newPage } from "../src/commands/new.js";
import { assertHuman, eject, lock, unlock, updateLock } from "../src/commands/lock.js";
import { readLock, sha256, writeLock } from "../src/lock.js";

const PRESET_RULES = path.resolve(__dirname, "../../preset-baseline/rules");

/** Minimal Next + shadcn-shaped project using the real baseline rules through a relative `extends`. */
function project(): string {
  const root = mkdtempSync(path.join(tmpdir(), "fcs-cli-"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app", devDependencies: {} }));
  writeFileSync(path.join(root, "components.json"), JSON.stringify({ aliases: { ui: "@/components/ui" }, registries: {} }));
  writeFileSync(
    path.join(root, "eslint.config.mjs"),
    'import next from "eslint-config-next";\n\nconst eslintConfig = [...next];\n\nexport default eslintConfig;\n',
  );
  cpSync(PRESET_RULES, path.join(root, "preset/rules"), { recursive: true });
  mkdirSync(path.join(root, ".design"), { recursive: true });
  writeFileSync(path.join(root, ".design/contract.yaml"), "extends: ../preset\n");
  mkdirSync(path.join(root, "app"), { recursive: true });
  writeFileSync(
    path.join(root, "app/page.tsx"),
    'import { Page } from "@/components/fcs/page";\nexport default function Home() { return <Page title="Home" />; }\n',
  );
  return root;
}

beforeEach(() => clearContractCache());

describe("init", () => {
  it("wires registry, eslint, claude hooks — idempotently, keeping an existing contract", () => {
    const root = project();
    const first = init(root, { claude: true, registry: "http://localhost/r/{name}.json" });
    expect(first.done).toEqual(
      expect.arrayContaining([
        "added @fcs registry to components.json",
        "added fcs.config() to eslint.config.mjs",
        expect.stringMatching(/Claude Code hooks/),
      ]),
    );
    expect(readFileSync(path.join(root, ".design/contract.yaml"), "utf8")).toBe("extends: ../preset\n");
    const eslint = readFileSync(path.join(root, "eslint.config.mjs"), "utf8");
    expect(eslint).toMatch(/^import fcs from "@gwinnguyen\/eslint-plugin-fcs";/);
    expect(eslint).toMatch(/const withFcs = \[\.\.\.eslintConfig, \.\.\.fcs\.config\(\)\];\n\nexport default withFcs;/);
    expect(first.todo.join()).toMatch(/Install dev dependencies/);

    const second = init(root, { claude: true });
    expect(second.done).toEqual([]);
    const settings = JSON.parse(readFileSync(path.join(root, ".claude/settings.json"), "utf8"));
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toMatch(/fcs hook post$/);
    expect(settings.hooks.Stop).toEqual([{ hooks: [{ type: "command", command: expect.stringMatching(/fcs hook stop$/) }] }]);
  });

  it("preserves unrelated Claude settings and hooks", () => {
    const root = project();
    mkdirSync(path.join(root, ".claude"));
    writeFileSync(
      path.join(root, ".claude/settings.json"),
      JSON.stringify({ model: "x", hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }] } }),
    );
    init(root);
    const settings = JSON.parse(readFileSync(path.join(root, ".claude/settings.json"), "utf8"));
    expect(settings.model).toBe("x");
    expect(settings.hooks.PostToolUse).toHaveLength(2);
  });
});

describe("init --codex", () => {
  it("writes .codex/hooks.json with apply_patch matchers, idempotently, keeping other hooks", () => {
    const root = project();
    mkdirSync(path.join(root, ".codex"));
    writeFileSync(
      path.join(root, ".codex/hooks.json"),
      JSON.stringify({ hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }] } }),
    );
    const first = init(root);
    expect(first.done).toEqual(expect.arrayContaining([expect.stringMatching(/Codex hooks/)]));
    expect(first.todo.join()).toMatch(/\/hooks/);
    expect(init(root, { codex: true }).done).toEqual([]);
    const config = JSON.parse(readFileSync(path.join(root, ".codex/hooks.json"), "utf8"));
    expect(config.hooks.PreToolUse).toEqual([
      { matcher: "apply_patch|Edit|Write", hooks: [{ type: "command", command: "npx --no-install fcs hook pre" }] },
    ]);
    expect(config.hooks.PostToolUse).toHaveLength(2);
    expect(config.hooks.Stop[0].hooks[0].command).toBe("npx --no-install fcs hook stop");
  });

  it("skips Codex unless detected or asked", () => {
    const root = project();
    const r = init(root);
    expect(r.todo.join()).toMatch(/fcs init --codex/);
  });
});

describe("check", () => {
  it("passes on a clean, built project", async () => {
    const root = project();
    build(root);
    const res = await check(root);
    expect(res.errors).toBe(0);
  });

  it("flags stale generated files", async () => {
    const root = project();
    const res = await check(root);
    expect(res.report).toMatch(/AGENTS\.md .*run `fcs build`/);
  });

  it("ignores eslint-disable for contract rules", async () => {
    const root = project();
    build(root);
    writeFileSync(
      path.join(root, "app/page.tsx"),
      "export default function Page() {\n  // eslint-disable-next-line\n  return <textarea />;\n}\n",
    );
    const res = await check(root);
    expect(res.report).toMatch(/fcs\/no-raw-textarea/);
    expect(res.report).toMatch(/fcs\/no-disable/);
  });

  it("detects modified, unknown and missing locked components", async () => {
    const root = project();
    build(root);
    mkdirSync(path.join(root, "components/fcs"), { recursive: true });
    writeFileSync(path.join(root, "components/fcs/a.tsx"), "export const A = 1;\n");
    writeFileSync(path.join(root, "components/fcs/b.tsx"), "export const B = 1;\n");
    writeLock(root, {
      version: 1,
      files: { "components/fcs/a.tsx": sha256("export const A = 1;\n"), "components/fcs/gone.tsx": "x" },
      project: {},
      ejected: {},
    });
    expect((await check(root)).errors).toBe(2); // b unknown, gone missing
    appendFileSync(path.join(root, "components/fcs/a.tsx"), "// tweak\n");
    const res = await check(root);
    expect(res.report).toMatch(/a\.tsx .*modified after install/);
    expect(readLock(root).files["components/fcs/a.tsx"]).toBeDefined();
  });
});

describe("hooks", () => {
  it("pre blocks locked files, the lock and the generated module", () => {
    const root = project();
    const pre = (file: string) => hookPre({ cwd: root, tool_input: { file_path: file } }, root).code;
    mkdirSync(path.join(root, "components/fcs"), { recursive: true });
    writeFileSync(path.join(root, "components/fcs/textarea-field.tsx"), "export {};\n");
    expect(pre(path.join(root, "components/fcs/textarea-field.tsx"))).toBe(2);
    const missing = hookPre({ cwd: root, tool_input: { file_path: "components/fcs/filter-bar.tsx" } }, root);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toMatch(/npx fcs add filter-bar/);
    expect(pre(".design/lock.json")).toBe(2);
    expect(pre("components/fcs/contract.generated.ts")).toBe(2);
    expect(pre("app/page.tsx")).toBe(0);
    expect(pre("components/ui/textarea.tsx")).toBe(0);
  });

  it("post feeds violations back with exit 2, stays quiet when clean", async () => {
    const root = project();
    build(root);
    expect((await hookPost({ cwd: root, tool_input: { file_path: "app/page.tsx" } }, root)).code).toBe(0);
    writeFileSync(path.join(root, "app/page.tsx"), 'import { Page } from "@/components/fcs/page";\nexport default function P() { return <Page title="P"><textarea /></Page>; }\n');
    const out = await hookPost({ cwd: root, tool_input: { file_path: "app/page.tsx" } }, root);
    expect(out.code).toBe(2);
    expect(out.stderr).toMatch(/^UI contract violations \(1 error/);
    expect(out.stderr).toMatch(/Use <TextareaField>/);
    expect(out.stderr).toMatch(/run `npx fcs add textarea-field` first/);
    expect((await hookPost({ cwd: root, tool_input: { file_path: "README.md" } }, root)).code).toBe(0);
  });

  it("reads Codex apply_patch payloads", async () => {
    const root = project();
    build(root);
    const patch = (body: string) => ({ cwd: root, tool_name: "apply_patch", tool_input: { command: `*** Begin Patch\n${body}\n*** End Patch\n` } });
    expect(patchFiles("*** Update File: a.tsx\n@@\n*** Move to: b.tsx\n*** Add File: c.ts\n*** Delete File: d.ts")).toEqual(["a.tsx", "b.tsx", "c.ts", "d.ts"]);
    expect(hookPre(patch("*** Update File: components/fcs/page.tsx\n@@\n-a\n+b"), root).code).toBe(2);
    expect(hookPre(patch("*** Add File: app/x/page.tsx\n+x"), root).code).toBe(0);

    mkdirSync(path.join(root, "app/notes"), { recursive: true });
    writeFileSync(path.join(root, "app/notes/page.tsx"), 'import { Page } from "@/components/fcs/page";\nexport default function P() { return <Page title="P"><textarea /></Page>; }\n');
    const out = await hookPost(patch("*** Add File: app/notes/page.tsx\n+…"), root);
    expect(out.code).toBe(2);
    expect(out.stderr).toMatch(/fcs\/no-raw-textarea/);
    expect((await hookPost(patch("*** Delete File: app/gone.tsx"), root)).code).toBe(0);
  });

  it("finds the project root from a subdirectory cwd", () => {
    const root = project();
    mkdirSync(path.join(root, "app/deep"), { recursive: true });
    expect(findRoot(path.join(root, "app/deep"))).toBe(path.resolve(root));
  });

  it("stop catches files written outside Edit/Write (e.g. shell heredoc), once", async () => {
    const root = project();
    build(root);
    const git = (...a: string[]) => spawnSync("git", a, { cwd: root });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
    expect((await hookStop({}, root)).code).toBe(0); // nothing changed

    mkdirSync(path.join(root, "app/notes"), { recursive: true });
    writeFileSync(path.join(root, "app/notes/page.tsx"), 'import { Page } from "@/components/fcs/page";\nexport default function P() { return <Page title="P"><textarea /></Page>; }\n');
    const out = await hookStop({}, root);
    expect(out.code).toBe(2);
    expect(out.stderr).toMatch(/app\/notes\/page\.tsx.*fcs\/no-raw-textarea/);
    expect((await hookStop({ stop_hook_active: true }, root)).code).toBe(0);
  });

  it("stop runs a full check outside git", async () => {
    const root = project();
    build(root);
    writeFileSync(path.join(root, "app/page.tsx"), 'import { Page } from "@/components/fcs/page";\nexport default function P() { return <Page title="P"><textarea /></Page>; }\n');
    expect((await hookStop({}, root)).code).toBe(2);
  });
});

describe("patterns (v0.2)", () => {
  it("check, the post hook and build all follow the project's own patterns", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "fcs-cli-patterns-"));
    mkdirSync(path.join(root, ".design"), { recursive: true });
    mkdirSync(path.join(root, "components/app"), { recursive: true });
    mkdirSync(path.join(root, "app/notes"), { recursive: true });
    writeFileSync(
      path.join(root, ".design/contract.yaml"),
      'patterns:\n  loading:\n    use: "@/components/app/loading-state#LoadingState"\n  page-frame:\n    files: "app/**/page.tsx"\n    root: ["@/components/app/shell#Shell"]\n',
    );
    writeFileSync(path.join(root, "components/app/loading-state.tsx"), 'import { Loader2 } from "lucide-react";\nexport function LoadingState() { return <Loader2 className="animate-spin" />; }\n');
    writeFileSync(path.join(root, "components/app/shell.tsx"), "export function Shell({ children }) { return <div>{children}</div>; }\n");
    writeFileSync(
      path.join(root, "app/notes/page.tsx"),
      'import { Shell } from "@/components/app/shell";\nimport { LoadingState } from "@/components/app/loading-state";\nexport default function P() { return <Shell><LoadingState /></Shell>; }\n',
    );
    build(root);
    expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toContain("use `<LoadingState>` (`@/components/app/loading-state`)");
    expect((await check(root)).report).toBe("fcs: contract satisfied ✓");

    writeFileSync(path.join(root, "app/notes/page.tsx"), 'export default function P() { return <main><p>Loading...</p></main>; }\n');
    const out = await hookPost({ cwd: root, tool_input: { file_path: "app/notes/page.tsx" } }, root);
    expect(out.code).toBe(2);
    expect(out.stderr).toMatch(/fcs\/pattern\(page-frame\): The default export returns <main> at its root\. Return <Shell> from @\/components\/app\/shell/);
    expect(out.stderr).toMatch(/fcs\/pattern\(loading\): Use <LoadingState> .* instead of the text "Loading\.\.\."/);
  });
});

describe("lock (v0.2 S2)", () => {
  function app(): string {
    const root = mkdtempSync(path.join(tmpdir(), "fcs-cli-lock-"));
    for (const [rel, content] of Object.entries({
      ".design/contract.yaml": 'patterns:\n  loading:\n    use: "@/components/app/loading-state#LoadingState"\n',
      "components/app/loading-state.tsx": "export function LoadingState() { return null; }\n",
      "components/app/card.tsx": "export function Card() { return null; }\n",
      "components/fcs/page.tsx": "export function Page() { return null; }\n",
    })) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), content);
    }
    writeLock(root, { version: 1, files: { "components/fcs/page.tsx": sha256("export function Page() { return null; }\n") }, project: {}, ejected: {} });
    return root;
  }
  const decisions = (root: string) => readdirSync(path.join(root, ".design/decisions")).sort();

  beforeEach(() => {
    process.env.FCS_ALLOW_NONINTERACTIVE = "1";
  });

  it("build locks canonical components; check and the pre hook then guard them", async () => {
    const root = app();
    expect((await check(root)).report).toMatch(/loading-state\.tsx .*canonical component of pattern "loading" is not locked/);
    const res = build(root);
    expect(res.find((w) => w.lockedFor)).toEqual({ file: "components/app/loading-state.tsx", changed: true, lockedFor: ["loading"] });
    expect(readLock(root).project).toHaveProperty(["components/app/loading-state.tsx"]);
    expect(build(root).some((w) => w.lockedFor)).toBe(false);
    expect((await check(root)).errors).toBe(0);

    const pre = hookPre({ cwd: root, tool_input: { file_path: "components/app/loading-state.tsx" } }, root);
    expect(pre.code).toBe(2);
    expect(pre.stderr).toMatch(/locked by the UI contract .* ask the user; a person updates it with `fcs lock --update`/);
    expect(hookPre({ cwd: root, tool_input: { file_path: "components/app/card.tsx" } }, root).code).toBe(0);

    appendFileSync(path.join(root, "components/app/loading-state.tsx"), "// tweak\n");
    expect((await check(root)).report).toMatch(/loading-state\.tsx .*modified after it was locked/);
    expect(() => updateLock(root, ["components/app/loading-state.tsx"], "")).toThrow(/needs --reason/);
    const up = updateLock(root, ["components/app/loading-state.tsx"], "Add inline variant for table cells.");
    expect(up.changed).toEqual(["components/app/loading-state.tsx"]);
    expect(readFileSync(path.join(root, up.decision!), "utf8")).toMatch(/Add inline variant/);
    expect((await check(root)).errors).toBe(0);
  });

  it("locks and unlocks arbitrary project files with decision records", () => {
    const root = app();
    build(root);
    const r = lock(root, ["components/app/card.tsx"], "Card is the one surface for dashboards.");
    expect(r.changed).toEqual(["components/app/card.tsx"]);
    expect(lock(root, ["components/app/card.tsx"]).changed).toEqual([]);
    expect(hookPre({ cwd: root, tool_input: { file_path: "components/app/card.tsx" } }, root).code).toBe(2);
    expect(() => unlock(root, ["components/app/loading-state.tsx"], "x")).toThrow(/canonical component of pattern loading/);
    expect(() => lock(root, ["nope.tsx"])).toThrow(/not a file/);
    expect(() => lock(root, ["../outside.tsx"])).toThrow(/outside the project/);
    expect(unlock(root, ["components/app/card.tsx"], "Cards vary per widget now.").changed).toEqual(["components/app/card.tsx"]);
    expect(readLock(root).project).not.toHaveProperty(["components/app/card.tsx"]);
    expect(decisions(root)).toEqual(["0001-lock-card-tsx.md", "0002-unlock-card-tsx.md"]);
  });

  it("eject moves a registry component under project ownership, still locked against agents", async () => {
    const root = app();
    build(root);
    expect(() => updateLock(root, ["components/fcs/page.tsx"], "x")).toThrow(/registry component; take ownership first/);
    const r = eject(root, ["page"], "Header needs tabs.");
    expect(r.changed).toEqual(["components/fcs/page.tsx"]);
    expect(readLock(root).files).toEqual({});
    expect(hookPre({ cwd: root, tool_input: { file_path: "components/fcs/page.tsx" } }, root).code).toBe(2);
    writeFileSync(path.join(root, "components/fcs/page.tsx"), "export function Page() { return <div />; }\n");
    expect((await check(root)).report).toMatch(/page\.tsx .*modified after it was locked/);
    updateLock(root, ["components/fcs/page.tsx"], "Tabs in the header.");
    expect((await check(root)).errors).toBe(0);
  });

  it("refuses to change locks without a person at a terminal", () => {
    delete process.env.FCS_ALLOW_NONINTERACTIVE;
    expect(() => assertHuman("unlock")).toThrow(/needs a person at an interactive terminal\. If you are an AI agent: stop and ask the user/);
  });
});

describe("import", () => {
  const CONFLICTING = [
    "# UI rules",
    "- Page loading states show a centered spinner.",
    "- While a table is loading, show skeleton rows.",
    "- Textareas must not be user-resizable.",
  ].join("\n");

  it("reports conflicts and refuses to write until decided", () => {
    const root = project();
    writeFileSync(path.join(root, "DESIGN.md"), CONFLICTING);
    const res = importDesignDoc(root, path.join(root, "DESIGN.md"), { write: true });
    expect(res.conflicts).toBe(1);
    expect(res.report).toContain("CONFLICT loading.page.pattern");
    expect(res.report).toContain("--decide loading.page.pattern=spinner|skeleton");
    expect(readFileSync(path.join(root, ".design/contract.yaml"), "utf8")).not.toContain("overrides");
  });

  it("writes the decision, records it, lists prose to fix, and rebuilds", () => {
    const root = project();
    writeFileSync(path.join(root, "DESIGN.md"), CONFLICTING);
    const res = importDesignDoc(root, path.join(root, "DESIGN.md"), {
      decide: ["loading.page.pattern=spinner"],
      write: true,
    });
    expect(res.conflicts).toBe(0);
    expect(res.written).toEqual([{ ruleId: "loading.page", param: "pattern", value: "spinner" }]);
    expect(res.report).toContain('DESIGN.md:3  "While a table is loading, show skeleton rows."');
    expect(res.decisionFile).toBe(".design/decisions/0001-import-design.md");
    expect(readFileSync(path.join(root, "components/fcs/contract.generated.ts"), "utf8")).toContain('"pattern": "spinner"');
    // The generated block now inside DESIGN.md must not be re-imported as prose.
    const again = importDesignDoc(root, path.join(root, "DESIGN.md"), { decide: ["loading.page.pattern=spinner"] });
    expect(again.report).toContain("3 statements");
  });

  it("rejects --decide for a param the document does not mention", () => {
    const root = project();
    writeFileSync(path.join(root, "DESIGN.md"), "- Textareas must not be user-resizable.");
    expect(() => importDesignDoc(root, path.join(root, "DESIGN.md"), { decide: ["loading.page.pattern=spinner"] })).toThrow(
      /params found: forms.textarea.resize.resize/,
    );
  });
});

describe("new page", () => {
  it("scaffolds pages that pass the page rules, with breadcrumbs only where the contract requires them", async () => {
    const root = project();
    expect(newPage(root, "customers", { template: "list" })).toEqual(["app/customers/page.tsx", "app/customers/loading.tsx"]);
    expect(newPage(root, "(app)/customers/[id]")).toEqual(["app/(app)/customers/[id]/page.tsx", "app/(app)/customers/[id]/loading.tsx"]);
    const list = readFileSync(path.join(root, "app/customers/page.tsx"), "utf8");
    expect(list).toContain('<ListPage title="Customers">');
    expect(list).not.toContain("breadcrumbs");
    const detail = readFileSync(path.join(root, "app/(app)/customers/[id]/page.tsx"), "utf8");
    expect(detail).toContain("params: Promise<{ id: string }>");
    expect(detail).toContain('{ label: "Customers", href: "/customers" },');
    expect(() => newPage(root, "customers")).toThrow(/already exists/);

    build(root);
    const res = await check(root, { format: "agent" });
    expect(res.report).toBe("");
    expect(res.errors).toBe(0);
  });
});
