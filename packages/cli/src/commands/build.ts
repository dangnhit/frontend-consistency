import { generateFiles, loadContract, resolveContract, writeGenerated, type WriteResult } from "@gwinnguyen/fcs-core";
import { lockCanonical } from "./lock.js";

export interface BuildResult extends WriteResult {
  /** Set when the file is a canonical pattern component that was just locked. */
  lockedFor?: string[];
}

/** Regenerate agent files and the params module, then lock any new canonical pattern components. */
export function build(root: string): BuildResult[] {
  const resolved = resolveContract(loadContract(root));
  const written: BuildResult[] = writeGenerated(generateFiles(resolved, root), root);
  for (const c of lockCanonical(root)) written.push({ file: c.file, changed: true, lockedFor: c.patterns });
  return written;
}

export function describeBuild(w: BuildResult): string {
  if (w.lockedFor) return `✓ locked ${w.file} (canonical component of pattern ${w.lockedFor.join(", ")})`;
  return `${w.changed ? "✓ wrote" : "· unchanged"} ${w.file}`;
}
