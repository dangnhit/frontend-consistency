import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MARK_END,
  MARK_START,
  generateFiles,
  loadContract,
  resolveContract,
  upsertRegion,
  writeGenerated,
} from "../src/index.js";

function setup(): string {
  const root = mkdtempSync(path.join(tmpdir(), "fcs-gen-"));
  mkdirSync(path.join(root, ".design/rules"), { recursive: true });
  writeFileSync(path.join(root, ".design/contract.yaml"), "params: { toast.durationMs: 4000 }\n");
  writeFileSync(
    path.join(root, ".design/rules/forms.yaml"),
    `
- id: forms.textarea.resize
  title: Textareas are not user-resizable
  why: Resize handles break alignment.
  params: { resize: none }
  do: <TextareaField label="Note" name="note" />
  dont: <textarea className="resize-y" />
  enforce: { component: "@fcs/textarea-field", lint: [fcs/no-raw-textarea] }
- id: forms.legacy.thing
  title: Disabled rule
  why: n/a
  severity: off
`,
  );
  return root;
}

describe("upsertRegion", () => {
  it("appends to existing content and preserves it", () => {
    const out = upsertRegion("# My project\n\nHand-written notes.\n", "BODY");
    expect(out).toBe(`# My project\n\nHand-written notes.\n\n${MARK_START}\nBODY\n${MARK_END}\n`);
  });
  it("replaces only the marked region", () => {
    const before = `top\n${MARK_START}\nOLD\n${MARK_END}\nbottom\n`;
    expect(upsertRegion(before, "NEW")).toBe(`top\n${MARK_START}\nNEW\n${MARK_END}\nbottom\n`);
  });
});

describe("generateFiles + writeGenerated", () => {
  it("renders active rules only, with component, params, why, do/dont", () => {
    const root = setup();
    const files = generateFiles(resolveContract(loadContract(root)), root, { cursor: true });
    const agents = files.find((f) => f.file === "AGENTS.md")!.content;
    expect(agents).toContain("`forms.textarea.resize` — Textareas are not user-resizable");
    expect(agents).toContain("**Use:** `@fcs/textarea-field`");
    expect(agents).toContain("`resize=none`");
    expect(agents).toContain('<textarea className="resize-y" />');
    expect(agents).not.toContain("forms.legacy.thing");
    expect(files.map((f) => f.file)).toContain(".cursor/rules/fcs.mdc");
  });

  it("emits a typed params module", () => {
    const root = setup();
    const mod = generateFiles(resolveContract(loadContract(root)), root).find((f) =>
      f.file.endsWith("contract.generated.ts"),
    )!.content;
    expect(mod).toContain('"forms.textarea.resize": {');
    expect(mod).toContain('"resize": "none"');
    expect(mod).toContain('"toast.durationMs": 4000');
  });

  it("is idempotent and preserves user content", () => {
    const root = setup();
    writeFileSync(path.join(root, "CLAUDE.md"), "# House rules\n\nUse pnpm.\n");
    const files = generateFiles(resolveContract(loadContract(root)), root);
    const first = writeGenerated(files, root);
    expect(first.every((r) => r.changed)).toBe(true);
    const second = writeGenerated(files, root);
    expect(second.some((r) => r.changed)).toBe(false);
    expect(readFileSync(path.join(root, "CLAUDE.md"), "utf8")).toMatch(/^# House rules\n\nUse pnpm\.\n\n<!-- fcs:start -->/);
  });

  it("dryRun reports staleness without writing", () => {
    const root = setup();
    const files = generateFiles(resolveContract(loadContract(root)), root);
    const res = writeGenerated(files, root, { dryRun: true });
    expect(res.every((r) => r.changed)).toBe(true);
    expect(() => readFileSync(path.join(root, "AGENTS.md"))).toThrow();
  });
});
