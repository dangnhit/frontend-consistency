import { generateFiles, loadContract, resolveContract, writeGenerated, type WriteResult } from "@frontend-consistency/core";

export function build(root: string): WriteResult[] {
  const resolved = resolveContract(loadContract(root));
  return writeGenerated(generateFiles(resolved, root), root);
}
