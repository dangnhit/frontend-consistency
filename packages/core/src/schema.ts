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

export const ContractSchema = z
  .object({
    extends: z
      .union([z.string(), z.array(z.string())])
      .transform((v) => (Array.isArray(v) ? v : [v]))
      .default([]),
    scopes: z.record(z.string(), ScopeDefSchema).default({}),
    params: ParamsSchema.default({}),
    overrides: z.record(RuleIdSchema, RulePatchSchema).default({}),
  })
  .strict();
export type Contract = z.infer<typeof ContractSchema>;
