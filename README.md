# frontend-consistency

Make AI coding agents (Claude Code, Codex, Cursor, Pi, ...) produce UI that is **consistent across screens** and **conforms to real design standards** — not "looks AI-generated".

## Problem

Rules written in `DESIGN.md` are suggestions. Agents forget them or drift back to training-data defaults:

- Screen A uses a spinner, screen B a skeleton
- Screen C has a breadcrumb header, screen D does not
- `<textarea>` must not be resizable — agent still emits resizable ones
- Spacing, alignment, and component composition drift from Material / standard design systems

More prompting does not fix this. Rules must move from *text the model reads* to *constraints a machine checks*.

## Approach: enforcement layers

| Layer | Mechanism | Status |
|---|---|---|
| 1. Context | Skill / rule files loaded at the right moment | planned (v1) |
| 2. Constrain | Opinionated component primitives — wrong usage is impossible | planned (v1) |
| 3. Detect | Custom lint rules run via agent hooks after every edit; agent self-corrects | planned (v1) |
| 4. Verify | Screenshot + visual/pixel audit (Playwright + reviewer agent) | phase 2 |

## Importing an existing DESIGN.md

Benchmarks (`bench/results/SUMMARY.md`) showed a clear prose DESIGN.md already steers agents well. Agents drift when the document contradicts itself: the same task ended up with a skeleton in one run and a spinner in the next. `fcs import` finds those contradictions and turns the team's answer into the one place agents and lint read from.

```sh
fcs import DESIGN.md
#   CONFLICT loading.page.pattern  (in effect: skeleton)
#     spinner   DESIGN.md:42  "Page and section loading states show a single centered spinner."
#     skeleton  DESIGN.md:66  "While a table is loading, show skeleton rows ..."
#     → pick one: --decide loading.page.pattern=spinner|skeleton
fcs import DESIGN.md --decide loading.page.pattern=spinner --write
#   writes .design/contract.yaml overrides + .design/decisions/0001-import-design.md,
#   lists the DESIGN.md lines that still say "skeleton", rebuilds agent files
```

Detection is deterministic. Each rule declares `detect:` patterns, so preset and project rules extend the importer without code changes. Prose that maps to no rule stays prose.

## Decision log

- **D1** — Scope v1 to layers 1–3; layer 4 deferred (cost, flakiness).
- **D2** — Open-source, multi-user project.
- **D3** — v1 targets **React + Next.js + shadcn/ui** (Tailwind, TypeScript). Architecture split: stack-agnostic *core* (design contract + agent-rule generators) and per-stack *adapters* (`adapter-react`: primitives + ESLint plugin). Other stacks via future adapters.
- **D4** — Ship an opinionated `baseline` preset (Material 3 + widely accepted practice). Projects `extends: baseline` and override per rule ID with `error`/`warn`/`off` (ESLint-style). Each rule declares: stable ID, *why*, do/don't code examples, severity, enforcement mechanism (component and/or lint rule).
- **D5** — A structured contract is the single source of truth; prose files are build outputs.
  ```
  .design/
    contract.yaml      # extends: baseline, tokens, params, scopes
    rules/*.yaml       # active rules only
    decisions/*.md     # ADRs: history, supersedes, approvals — never fed to agents
  ```
  Rule schema extends D4 with `scope` (route/surface/portal), `params` (referenced values, e.g. 300ms, 44px), `exceptions`, and `supersedes`/`source`. CLI: `fcs build` (generate DESIGN.md / AGENTS.md / CLAUDE.md / .cursor/rules — active, in-scope rules only), `fcs check` (detect contradicting rules), `fcs import` (maps an existing prose DESIGN.md onto contract params, surfacing conflicts for the user to resolve — see below).
- **D6** — Layer-2 components ship via a **shadcn registry** (`npx shadcn add @fcs/<name>`) into `components/fcs/*`, built on the project's own shadcn primitives. Protected by `.design/lock.json` (per-file hash): `fcs check` fails on modification unless done through `fcs eject <component>`, which requires a decision record. Agent hooks block Edit/Write on `components/fcs/**`.
  v1 component set:

  | Component | Enforces |
  |---|---|
  | `AppShell` + `PageHeader` | breadcrumb / title / actions in fixed slots; no ad-hoc h1 |
  | `AsyncBoundary` | loading / empty / error / filtered-empty; skeleton vs spinner chosen by contract |
  | `Field` + `TextareaField` | required label, error, hint; resize per contract |
  | `ConfirmDialog` | replaces `window.confirm`; safe action focused; fixed button order |
  | `SubmitButton` | pending state keeps width, `aria-busy` |
  | `DataTable` | own scroll region, URL-state pagination |
  | `FilterBar` | single-row filter chrome, URL-synced state, clear-all, filtered-empty hand-off to `AsyncBoundary` |
  | `Toast` (`notify()` API) | one placement, variant set, durations from contract params; bans ad-hoc toast calls |
  | `StatusBadge` | status-to-color map from one source |
  | `IconButton` | `aria-label` + tooltip required at type level |
  | `EmptyState`, `Section`, `Stack` | spacing accepts tokens only |
- **D7** — Layer 3 = `@frontend-consistency/eslint-plugin` (ESLint 9+ flat config preset; Biome deferred). Every message names the rule ID, the component to use, and the contract source, e.g. `fcs/no-raw-textarea: Use <TextareaField> from @/components/fcs. Rule textarea.resize = none (.design/rules/forms.yaml)`. `fcs/no-disable` forbids disabling `fcs/*` rules inline. `fcs init` detects agents present and installs per-agent feedback hooks:

  | Agent | Hook |
  |---|---|
  | Claude Code | `PostToolUse` on Edit/Write: lint touched file, exit 2 to feed errors back |
  | Cursor | `afterFileEdit` hook + generated rules |
  | Codex, Pi | `AGENTS.md` instruction to run `fcs check` before finishing |
  | All | pre-commit + CI gate as final backstop |

  MCP server (`fc_check`, `fc_rules_for(file)`) deferred to phase 2.
- **D8** — Design quality via page-level structure, not per-component prompting:
  1. **Page templates** in the registry: `ListPage`, `DetailPage`, `FormPage`, `SettingsPage`, `DashboardPage`, `AuthPage` (fixed header, content max-width, gutters, action placement, spacing rhythm). `fcs/page-template` requires every `app/**/page.tsx` to render a template at its root; `fcs new page <name> --template <t>` scaffolds. Marketing/landing routes opt out via `scope`. SaaS/admin templates first.
  2. **Strict tokens**: spacing scale only, fixed control heights, no arbitrary Tailwind values, no off-contract shadows/gradients.
  3. **Anti-slop rules** in `baseline` (why + do/don't): one primary action per region, no card-in-card, no decorative heading icons, no emoji in UI, one h1 per page — lint where countable, prompt otherwise.
- **D9** — `baseline` keeps shadcn's visual language and standardizes the *measurable skeleton* drawn from Material 3, Apple HIG, WCAG 2.2 and Refactoring UI: 4/8pt grid, paired type scale, control heights 32/36/40 by density, target size ≥ 24px (44px on touch), contrast ≥ 4.5:1, layout grid/breakpoints/gutters, action ordering, consistent focus ring, motion 150–250ms with standard easing. Visual flavor (radius, shadow, color) lives in tokens; an M3 flavor can later ship as a token preset, not a rule rewrite.
- **D10** — Naming: repo and npm scope `@frontend-consistency/*` (`cli`, `eslint-plugin`, `preset-baseline`); entry point `npx frontend-consistency init`; CLI binary **`fcs`** (`fc` is a bash/zsh builtin and taken on npm). Lint rule prefix `fcs/`, shadcn registry namespace `@fcs`, installed components under `components/fcs/`.
- **D11** — Effectiveness is measured, not asserted. `bench/` holds a clean Next + shadcn fixture app with a contract and ~20 UI tasks, each targeting a known drift (list page with filters, notes form, delete with confirm, ...). Each task runs 3× across `{no tool, DESIGN.md only, full fcs}` × `{Claude Code, Codex}` (Cursor later — no headless mode). Deterministic scoring: `fcs/*` violations, arbitrary values, pages without a template, and cross-run structural divergence. Results table published in README; run manually/scheduled, not per-PR (token cost). Real-world dogfood: an existing production Next + shadcn app via `fcs import`.
- **D12** — Build order: tracer-bullet slices, each crossing every layer. Slice 1 `forms.textarea.resize`; slice 2 `loading.page` (`AsyncBoundary`, conditional rule, exercises `scope`/`params`); slice 3 `PageHeader` + `ListPage` (page-level rule). Then expand to the full `baseline`. Tooling: pnpm workspaces + Turborepo, TypeScript, tsup, vitest, Changesets, MIT. Layout: `packages/{cli,core,eslint-plugin,preset-baseline}`, `registry/`, `bench/`.

_Full spec: [docs/spec.md](docs/spec.md)._

## License

MIT
