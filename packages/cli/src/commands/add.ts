import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { componentFiles, readLock, sha256, writeLock } from "../lock.js";
import { build } from "./build.js";

/** Pinned so registry output is reproducible; override with FCS_SHADCN (e.g. "shadcn@latest"). */
export const SHADCN = process.env.FCS_SHADCN ?? "shadcn@4.21.5";

function snapshot(root: string): Map<string, string> {
  return new Map(componentFiles(root).map((f) => [f, sha256(readFileSync(path.join(root, f)))]));
}

/**
 * Install registry components and lock every file the install created or changed.
 * The params module is regenerated afterwards because the registry ships a default copy.
 */
export function add(root: string, names: string[]): string[] {
  const before = snapshot(root);
  const items = names.map((n) => (n.startsWith("@") || n.includes("/") ? n : `@fcs/${n}`));
  const res = spawnSync("npx", ["-y", SHADCN, "add", ...items, "--yes", "--overwrite"], { cwd: root, stdio: "inherit" });
  if (res.status !== 0) throw new Error(`shadcn add failed (exit ${res.status})`);

  const lock = readLock(root);
  const locked: string[] = [];
  for (const [file, hash] of snapshot(root)) {
    if (before.get(file) !== hash || !lock.files[file]) {
      lock.files[file] = hash;
      delete lock.ejected[file];
      locked.push(file);
    }
  }
  writeLock(root, lock);
  if (existsSync(path.join(root, ".design/contract.yaml"))) build(root);
  return locked;
}
