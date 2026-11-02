# frontend-consistency — Specification (v1)

Status: draft, derived from decisions D1–D12 in [README](../README.md).

## 1. Goals

1. **Consistency** — the same UI concern (loading, header, form control, confirm, toast…) is solved the same way on every screen, every agent run, every agent.
2. **Standard quality** — generated UI follows a measurable design skeleton (grid, type scale, sizing, contrast, action order) instead of training-data defaults.
3. **Agent-agnostic** — works with Claude Code, Codex, Cursor, Pi; strongest where the agent supports hooks.

### Non-goals (v1)

- Visual/screenshot verification (layer 4) — phase 2.
- Stacks other than React + Next.js (App Router) + shadcn/ui + Tailwind.
- MCP server — phase 2.
- Biome support — later.

## 2. Principle

> A rule the model only *reads* is a suggestion. A rule the machine *checks* is a constraint.

Every rule is pushed as far down this ladder as it can go:

| Layer | Mechanism | Reliability |
|---|---|---|
| 1 Context | generated, scoped agent instructions | probabilistic |
| 2 Constrain | locked registry components — wrong usage impossible | by construction |
| 3 Detect | ESLint rules + agent feedback hooks — agent self-corrects | deterministic |
| 4 Verify | screenshot audit | phase 2 |

## 3. Contract (source of truth)

```
.design/
  contract.yaml        # extends, tokens, params, scopes
  rules/*.yaml         # active rules
  decisions/*.md       # ADRs — history, supersession, approvals; never fed to agents
  lock.json            # hashes of installed registry components
```

### 3.1 `contract.yaml`

```yaml
extends: "@frontend-consistency/preset-baseline"
scopes:
  app:       { include: ["app/(app)/**"] }
  marketing: { include: ["app/(marketing)/**"] }
params:
  loading.skeletonThresholdMs: 300
  toast.durationMs: 4000
  table.pageSize: 20
overrides:
  forms.textarea.resize: { params: { resize: vertical } }   # project decision
  layout.page-template: { severity: off, scope: marketing }
```

### 3.2 Rule schema (`rules/*.yaml`)

```yaml
- id: forms.textarea.resize            # stable, dotted, unique
  title: Textareas are not user-resizable
  why: >
    Resize handles break grid alignment and let one field push the layout.
    Height is chosen by content type, not by the user.
  severity: error                      # error | warn | off
  scope: [app]                         # optional; default all
  params:
    resize: none                       # none | vertical
  exceptions:
    - path: "app/(app)/notes/editor/**"
      reason: long-form editor, decision 0007
  do: |
    <TextareaField label="Note" name="note" rows={4} />
  dont: |
    <textarea className="resize-y" />
  enforce:
    component: "@fcs/textarea-field"
    lint: ["fcs/no-raw-textarea"]
  source: decisions/0003-textarea.md   # optional provenance
  supersedes: []                       # rule ids this replaces
```

Validation (`fcs check --contract`): schema (zod), unique ids, unknown override targets, conflicting rules on the same id+scope, expired `supersedes` references.

### 3.3 Resolution order

`preset rules` → `project rules/*.yaml` → `contract.yaml overrides`. Later wins, field-merged. Result = **resolved contract** (JSON), the single input for every generator.

## 4. CLI — `fcs`

| Command | Does |
|---|---|
| `npx frontend-consistency init` | scaffold `.design/`, add registry namespace to `components.json`, add ESLint preset, detect agents, install hooks |
| `fcs build` | resolve contract → generate agent files + `components/fcs/contract.generated.ts` |
| `fcs check` | contract validation + lock-hash verification + ESLint on project (or `--files`) |
| `fcs eject <component>` | unlock a registry component; requires a decision record |
| `fcs new page <name> --template <t>` | scaffold route from page template |
| `fcs import <DESIGN.md> [--decide rule.param=value] [--write]` | deterministic: maps prose statements onto rule params via each rule's `detect:` patterns, reports agreement and conflicts with line evidence. `--write` (only once every conflict is decided) writes `overrides`, records `decisions/NNNN-import-*.md`, lists the losing DESIGN.md lines to fix, and rebuilds. Unmapped prose stays prose. Exit 1 while conflicts remain. LLM-assisted extraction of unmapped prose into new project rules: later. |

### 4.1 Generated agent files

Marked regions only (`<!-- fcs:start -->…<!-- fcs:end -->`), never clobber user content.

- `CLAUDE.md`, `AGENTS.md`, `DESIGN.md`, `.cursor/rules/fcs.mdc`
- Content: active rules only, grouped by area, each with id, one-line rule, why, do/don't, and "use component X". Scoped rules emitted with their globs (Cursor `globs:` frontmatter; path notes elsewhere).
- Budget: keep generated block compact; full detail lives in `.design/rules`, referenced by path.

### 4.2 Runtime params

`fcs build` emits `components/fcs/contract.generated.ts` (typed constants). Registry components import params from it, so a contract change re-styles components without editing locked files.

## 5. Registry components (layer 2)

- Distributed as a shadcn registry under namespace `@fcs`; installed to `components/fcs/`; built on the project's own shadcn primitives.
- `.design/lock.json` stores per-file SHA-256 at install. `fcs check` fails on drift unless ejected.
- Agent hooks deny Edit/Write on `components/fcs/**` (except `contract.generated.ts`, written only by `fcs build`).

v1 set: `AppShell`, `PageHeader`, `AsyncBoundary`, `Field`, `TextareaField`, `ConfirmDialog`, `SubmitButton`, `DataTable`, `FilterBar`, `Toast`/`notify()`, `StatusBadge`, `IconButton`, `EmptyState`, `Section`, `Stack`.
Page templates: `ListPage`, `DetailPage`, `FormPage`, `SettingsPage`, `DashboardPage`, `AuthPage`.

## 6. ESLint plugin (layer 3)

`@frontend-consistency/eslint-plugin`, flat config, `fcs.configs.recommended` reads the resolved contract (severity, params, scope, exceptions) — rules are not configured twice.

Message format (mandatory): rule id → component to use → contract source.

```
fcs/no-raw-textarea: Use <TextareaField> from @/components/fcs. Rule forms.textarea.resize = none (.design/rules/forms.yaml)
```

Guard rules: `fcs/no-disable` (no inline disabling of `fcs/*`), `fcs/no-arbitrary-values`, `fcs/page-template`.

## 7. Agent hooks

| Agent | Mechanism | Feedback |
|---|---|---|
| Claude Code | `.claude/settings.json` `PreToolUse` (deny edits to `components/fcs/**`) + `PostToolUse` on `Edit\|Write\|MultiEdit` → lint the edited file + `Stop` → full `fcs check` on changed files (catches shell-written files and lock tampering; blocks once) | exit 2, stderr returned to the model |
| Cursor | generated `.cursor/rules` + `afterFileEdit` hook | observational only — relies on rules + pre-commit |
| Codex, Pi | `AGENTS.md` instruction: run `fcs check` before finishing | instruction-based; verify native hook support at implementation |
| All | pre-commit + CI `fcs check` | hard gate |

## 8. Preset `baseline`

shadcn visual language + measurable skeleton from Material 3, Apple HIG, WCAG 2.2, Refactoring UI: 4/8pt spacing, paired type scale, control heights 32/36/40, target size ≥ 24px (44px touch), contrast ≥ 4.5:1, breakpoints/gutters, action order, focus ring, motion 150–250ms. Anti-slop rules: one primary action per region, no card-in-card, no decorative heading icons, no emoji in UI, one h1 per page, no native `alert`/`confirm`/`prompt`, failed load never rendered as empty/zero, icon-only controls named.

## 9. Benchmark

`bench/`: fixture Next + shadcn app, ~20 drift-targeted tasks, 3 runs each, matrix `{none, DESIGN.md only, fcs}` × `{Claude Code, Codex}`. Scores: `fcs/*` violations, arbitrary values, template-less pages, cross-run structural divergence. Manual/scheduled.

## 10. Repository layout

```
packages/
  core/             # schema (zod), loader, resolver, generators
  cli/              # fcs binary
  eslint-plugin/
  preset-baseline/  # rules/*.yaml
registry/           # shadcn registry sources → static JSON
bench/
docs/
```

pnpm workspaces, Turborepo, TypeScript, tsup, vitest, Changesets, MIT.

## 11. Delivery slices

1. `forms.textarea.resize` end-to-end — see [plans/slice-1.md](plans/slice-1.md).
2. `loading.page` + `AsyncBoundary` (conditional rule, scope, params).
3. `PageHeader` + `ListPage` (page-level rule, `fcs new page`).
4. Expand baseline + remaining components; `fcs import` (param detection shipped; LLM-assisted new-rule extraction later); benchmark report.
