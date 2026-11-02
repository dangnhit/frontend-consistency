/** Helpers shared by the page-level rules. */

const PAGE_FILE = /^(?:src\/)?app\/(?:(.*)\/)?page\.(?:t|j)sx?$/;

/** True for Next App Router page files (`app/**\/page.tsx`, optionally under `src/`). */
export function isPageFile(relPath: string): boolean {
  return PAGE_FILE.test(relPath);
}

/**
 * URL depth of a page file: `app/page.tsx` → 0, `app/customers/page.tsx` → 1, `app/(app)/customers/[id]/page.tsx` → 2.
 * Route groups `(x)`, parallel slots `@x` and intercepting markers do not add depth.
 */
export function routeDepth(relPath: string): number {
  const dir = PAGE_FILE.exec(relPath)?.[1];
  if (!dir) return 0;
  return dir.split("/").filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@")).length;
}

/** Modules that hold locked fcs components (`@/components/fcs/page`, `../components/fcs/list-page`, …). */
export function isFcsModule(src: string): boolean {
  return /(^|\/)components\/fcs\//.test(src);
}

/** Page templates are fcs exports named `Page` or `…Page`. */
export function isTemplateExport(name: string): boolean {
  return /Page$/.test(name);
}
