import { generateFiles, loadContract, resolveContract, writeGenerated, type WriteResult } from "@gwinnguyen/fcs-core";

export function build(root: string): WriteResult[] {
  const resolved = resolveContract(loadContract(root));
  return writeGenerated(generateFiles(resolved, root), root);
}
