import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getRule, loadContract, resolveContract } from "@gwinnguyen/fcs-core";

describe("preset-baseline", () => {
  it("resolves through `extends` by package name and validates", () => {
    const root = mkdtempSync(path.join(tmpdir(), "fcs-preset-"));
    writeFileSync(path.join(root, "package.json"), "{}");
    mkdirSync(path.join(root, ".design"));
    writeFileSync(path.join(root, ".design/contract.yaml"), 'extends: "@gwinnguyen/fcs-preset-baseline"\n');
    mkdirSync(path.join(root, "node_modules/@gwinnguyen"), { recursive: true });
    symlinkSync(path.resolve(__dirname, ".."), path.join(root, "node_modules/@gwinnguyen/fcs-preset-baseline"));

    const resolved = resolveContract(loadContract(root));
    const rule = getRule(resolved, "forms.textarea.resize");
    expect(rule?.params.resize).toBe("none");
    expect(rule?.enforce?.lint).toContain("fcs/no-raw-textarea");
  });
});
