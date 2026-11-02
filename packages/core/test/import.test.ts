import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeDesignDoc,
  extractStatements,
  loadContract,
  resolveContract,
  writeOverrides,
  type ResolvedContract,
} from "../src/index.js";

const PRESET_RULES = path.resolve(__dirname, "../../preset-baseline/rules");

function project(contract = "extends: ../preset\n"): string {
  const root = mkdtempSync(path.join(tmpdir(), "fcs-import-"));
  cpSync(PRESET_RULES, path.join(root, "preset/rules"), { recursive: true });
  mkdirSync(path.join(root, ".design"), { recursive: true });
  writeFileSync(path.join(root, ".design/contract.yaml"), contract);
  return root;
}

const resolved = (root: string): ResolvedContract => resolveContract(loadContract(root));

function votes(md: string, id: string): Record<string, number[]> {
  const f = analyzeDesignDoc(md, resolved(project())).findings.find((x) => `${x.ruleId}.${x.param}` === id);
  return Object.fromEntries([...(f?.votes ?? new Map())].map(([v, evs]) => [v, evs.map((e: { line: number }) => e.line)]));
}

describe("extractStatements", () => {
  it("splits list items and paragraphs, joins continuation lines, skips fences and the generated region", () => {
    const md = [
      "# Loading",
      "1. Show a spinner.",
      "   Also in buttons.",
      "- Second item",
      "",
      "A paragraph",
      "that wraps.",
      "```tsx",
      "<Skeleton />",
      "```",
      "<!-- fcs:start -->",
      "- generated rule about skeleton loading",
      "<!-- fcs:end -->",
    ].join("\n");
    expect(extractStatements(md)).toEqual([
      { line: 2, text: "Show a spinner. Also in buttons.", heading: "Loading" },
      { line: 4, text: "Second item", heading: "Loading" },
      { line: 6, text: "A paragraph that wraps.", heading: "Loading" },
    ]);
  });
});

describe("analyzeDesignDoc", () => {
  it("detects a conflict between two loading patterns", () => {
    const md = [
      "- Page loading states show a centered spinner. Do not use skeletons anywhere.",
      "- While a table is loading, show skeleton rows.",
    ].join("\n");
    expect(votes(md, "loading.page.pattern")).toEqual({ spinner: [1, 1], skeleton: [2] });
  });

  it("ignores spinners inside buttons", () => {
    const md = "- Loading pages show skeletons. Spinners are used inside buttons while submitting.";
    expect(votes(md, "loading.page.pattern")).toEqual({ skeleton: [1] });
  });

  it("reads numbers and textarea resize, including negated phrasing", () => {
    const md = [
      "- Do not show a loading state for responses faster than 250 ms.",
      "- Textareas must not be user-resizable.",
    ].join("\n");
    const a = analyzeDesignDoc(md, resolved(project()));
    const byKey = Object.fromEntries(a.findings.map((f) => [`${f.ruleId}.${f.param}`, f.agreed]));
    expect(byKey).toEqual({ "loading.page.delayMs": 250, "forms.textarea.resize.resize": "none" });
    expect(a.mapped.size).toBe(2);
  });

  it("returns nothing for unrelated prose", () => {
    expect(analyzeDesignDoc("- Buttons use sentence case.", resolved(project())).findings).toEqual([]);
  });
});

describe("writeOverrides", () => {
  it("adds block-style overrides, keeps comments, skips values already in effect", () => {
    const root = project("extends: ../preset\n\n# keep me\noverrides: {}\n");
    const file = path.join(root, ".design/contract.yaml");
    const written = writeOverrides(
      file,
      [
        { ruleId: "loading.page", param: "pattern", value: "spinner" },
        { ruleId: "loading.page", param: "delayMs", value: 300 },
      ],
      resolved(root),
    );
    expect(written).toEqual([{ ruleId: "loading.page", param: "pattern", value: "spinner" }]);
    const text = readFileSync(file, "utf8");
    expect(text).toContain("# keep me");
    expect(text).toContain("overrides:\n  loading.page:\n    params:\n      pattern: spinner\n");
    expect(resolved(root).rules.find((r) => r.id === "loading.page")?.params.pattern).toBe("spinner");
  });
});
