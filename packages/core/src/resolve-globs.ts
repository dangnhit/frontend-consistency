import picomatch from "picomatch";

/**
 * Compile globs. Parentheses are matched literally: Next.js route groups like `app/(app)/**`
 * are far more common in this domain than regex groups. Use `{a,b}` for alternation.
 */
export function compileGlobs(globs: string[]): (p: string) => boolean {
  if (!globs.length) return () => false;
  const escaped = globs.map((g) => g.replace(/(?<!\\)([()])/g, "\\$1"));
  return picomatch(escaped, { dot: true });
}
