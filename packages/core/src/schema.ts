import { z } from "zod";

export const SeveritySchema = z.enum(["error", "warn", "off"]);
export type Severity = z.infer<typeof SeveritySchema>;

const RuleIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/, "rule id must be dotted lowercase, e.g. forms.textarea.resize");

const ParamValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type ParamValue = z.infer<typeof ParamValueSchema>;
const ParamsSchema = z.record(z.string(), ParamValueSchema);

const ExceptionSchema = z.object({
  path: z.string().min(1),
  reason: z.string().min(1),
});
export type RuleException = z.infer<typeof ExceptionSchema>;

const ScopeRefSchema = z.union([z.string(), z.array(z.string())]).transform((v) => (Array.isArray(v) ? v : [v]));

/**
 * How `fcs import` recognises this rule's params in a prose DESIGN.md.
 * Patterns are case-insensitive regex sources. A statement must match `topic`; a sentence matching `ignore`
 * is skipped. Each param maps either enum values to patterns, or a `number` pattern with one capture group.
 */
const DetectParamSchema = z.union([
  z.object({ values: z.record(z.string(), z.string()) }).strict(),
  z.object({ number: z.string() }).strict(),
]);
export type DetectParam = z.infer<typeof DetectParamSchema>;
const DetectSchema = z
  .object({
    topic: z.string(),
    ignore: z.string().optional(),
    params: z.record(z.string(), DetectParamSchema),
  })
  .strict();
export type Detect = z.infer<typeof DetectSchema>;

export const RuleSchema = z.object({
  id: RuleIdSchema,
  title: z.string().min(1),
  why: z.string().min(1),
  severity: SeveritySchema.default("error"),
  scope: ScopeRefSchema.optional(),
  params: ParamsSchema.default({}),
  exceptions: z.array(ExceptionSchema).default([]),
  do: z.string().optional(),
  dont: z.string().optional(),
  enforce: z
    .object({
      component: z.string().optional(),
      lint: z.array(z.string()).default([]),
    })
    .optional(),
  source: z.string().optional(),
  detect: DetectSchema.optional(),
  supersedes: z.array(RuleIdSchema).default([]),
});
export type Rule = z.infer<typeof RuleSchema>;

export const RuleFileSchema = z.array(RuleSchema);

/** Partial rule used to patch an existing rule from a later layer. */
export const RulePatchSchema = z
  .object({
    severity: SeveritySchema,
    scope: ScopeRefSchema,
    params: ParamsSchema,
    exceptions: z.array(ExceptionSchema),
  })
  .partial()
  .strict();
export type RulePatch = z.infer<typeof RulePatchSchema>;

export const ScopeDefSchema = z.object({
  include: z.array(z.string()).min(1),
  exclude: z.array(z.string()).default([]),
});
export type ScopeDef = z.infer<typeof ScopeDefSchema>;

/**
 * One thing a pattern forbids. Exactly one matcher per entry:
 * - `import`: `"module"` (any import from it) or `"module#Name"` (that named export; `#default` for the default)
 * - `element`: JSX element name, e.g. `textarea`, `h1`
 * - `className`: a class token (`animate-spin`; variants like `md:` are ignored) or `/regex/`
 * - `call`: callee, e.g. `window.confirm`; `toast` also matches `toast.success(…)`; `.toFixed` matches any `x.toFixed(…)`
 * - `text`: regex (case-insensitive) tested against trimmed JSX text, e.g. `^Loading(\.{3}|…)?$`
 */
export const ForbidSchema = z.union([
  z.object({ import: z.string().min(1) }).strict(),
  z.object({ element: z.string().min(1) }).strict(),
  z.object({ className: z.string().min(1) }).strict(),
  z.object({ call: z.string().min(1) }).strict(),
  z.object({ text: z.string().min(1) }).strict(),
]);
export type Forbid = z.infer<typeof ForbidSchema>;

const RefSchema = z.string().regex(/^[^#\s]+#[A-Za-z_$][\w$]*$/, 'expected "module#Export", e.g. "@/components/app/loading-state#LoadingState"');
const RefListSchema = z.union([RefSchema, z.array(RefSchema).min(1)]).transform((v) => (Array.isArray(v) ? v : [v]));
const GlobListSchema = z.union([z.string(), z.array(z.string())]).transform((v) => (Array.isArray(v) ? v : [v]));

export const PatternIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, "pattern id must be lowercase kebab-case, e.g. page-frame");

/** How this project solves one UI concern. See docs/spec-v0.2.md §3. */
export const PatternSchema = z
  .object({
    concern: PatternIdSchema.optional(),
    /** Canonical component(s) to use for this concern. */
    use: RefListSchema.optional(),
    /** For frame-like concerns: allowed root elements of the default export in `files`. */
    root: RefListSchema.optional(),
    /** Files this pattern applies to (globs relative to the contract's project root). Default: all source files. */
    files: GlobListSchema.optional(),
    scope: ScopeRefSchema.optional(),
    except: z.array(ExceptionSchema).default([]),
    /** What to report. Default: the concern catalog's signals, minus the modules in `use`. */
    forbid: z.array(ForbidSchema).optional(),
    severity: SeveritySchema.default("error"),
    status: z.enum(["decided", "proposed"]).default("decided"),
    why: z.string().optional(),
    /** Required when redefining a pattern inherited from a parent contract. */
    reason: z.string().optional(),
    /** Lock canonical components against agent edits (S2). */
    lock: z.boolean().default(true),
  })
  .strict()
  .refine((p) => p.root === undefined || p.files !== undefined, { message: "`root` needs `files` (which files must use it)" });
export type Pattern = z.infer<typeof PatternSchema>;

export const ContractSchema = z
  .object({
    extends: z
      .union([z.string(), z.array(z.string())])
      .transform((v) => (Array.isArray(v) ? v : [v]))
      .default([]),
    scopes: z.record(z.string(), ScopeDefSchema).default({}),
    params: ParamsSchema.default({}),
    overrides: z.record(RuleIdSchema, RulePatchSchema).default({}),
    patterns: z.record(PatternIdSchema, PatternSchema).default({}),
  })
  .strict();
export type Contract = z.infer<typeof ContractSchema>;
