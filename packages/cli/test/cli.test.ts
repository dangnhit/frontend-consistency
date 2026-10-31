import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { clearContractCache } from "@frontend-consistency/eslint-plugin";
import { build } from "../src/commands/build.js";
import { check } from "../src/commands/check.js";
import { hookPost, hookPre } from "../src/commands/hook.js";
import { init } from "../src/commands/init.js";
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
  writeFileSync(path.join(root, "app/page.tsx"), "export default function Page() { return <main />; }\n");
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
    expect(eslint).toMatch(/^import fcs from "@frontend-consistency\/eslint-plugin";/);
    expect(eslint).toMatch(/const withFcs = \[\.\.\.eslintConfig, \.\.\.fcs\.config\(\)\];\n\nexport default withFcs;/);
    expect(first.todo.join()).toMatch(/Install dev dependencies/);

    const second = init(root, { claude: true });
    expect(second.done).toEqual([]);
    const settings = JSON.parse(readFileSync(path.join(root, ".claude/settings.json"), "utf8"));
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toMatch(/fcs hook post$/);
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
    expect(pre(path.join(root, "components/fcs/textarea-field.tsx"))).toBe(2);
    expect(pre(".design/lock.json")).toBe(2);
    expect(pre("components/fcs/contract.generated.ts")).toBe(2);
    expect(pre("app/page.tsx")).toBe(0);
    expect(pre("components/ui/textarea.tsx")).toBe(0);
  });

  it("post feeds violations back with exit 2, stays quiet when clean", async () => {
    const root = project();
    build(root);
    expect((await hookPost({ cwd: root, tool_input: { file_path: "app/page.tsx" } }, root)).code).toBe(0);
    writeFileSync(path.join(root, "app/page.tsx"), "export default function P() { return <textarea />; }\n");
    const out = await hookPost({ cwd: root, tool_input: { file_path: "app/page.tsx" } }, root);
    expect(out.code).toBe(2);
    expect(out.stderr).toMatch(/^UI contract violations \(1 error/);
    expect(out.stderr).toMatch(/Use <TextareaField>/);
    expect((await hookPost({ cwd: root, tool_input: { file_path: "README.md" } }, root)).code).toBe(0);
  });
});
