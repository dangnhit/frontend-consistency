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
  Rule schema extends D4 with `scope` (route/surface/portal), `params` (referenced values, e.g. 300ms, 44px), `exceptions`, and `supersedes`/`source`. CLI: `fc build` (generate DESIGN.md / AGENTS.md / CLAUDE.md / .cursor/rules — active, in-scope rules only), `fc check` (detect contradicting rules), `fc import` (LLM-assisted extraction from an existing prose DESIGN.md, surfacing conflicts for the user to resolve).
- **D6** — Layer-2 components ship via a **shadcn registry** (`npx shadcn add @fc/<name>`) into `components/fc/*`, built on the project's own shadcn primitives. Protected by `.design/lock.json` (per-file hash): `fc check` fails on modification unless done through `fc eject <component>`, which requires a decision record. Agent hooks block Edit/Write on `components/fc/**`.
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
- **D7** — Layer 3 = `eslint-plugin-fc` (ESLint 9+ flat config preset; Biome deferred). Every message names the rule ID, the component to use, and the contract source, e.g. `fc/no-raw-textarea: Use <TextareaField> from @/components/fc. Rule textarea.resize = none (.design/rules/forms.yaml)`. `fc/no-disable` forbids disabling `fc/*` rules inline. `fc init` detects agents present and installs per-agent feedback hooks:

  | Agent | Hook |
  |---|---|
  | Claude Code | `PostToolUse` on Edit/Write: lint touched file, exit 2 to feed errors back |
  | Cursor | `afterFileEdit` hook + generated rules |
  | Codex, Pi | `AGENTS.md` instruction to run `fc check` before finishing |
  | All | pre-commit + CI gate as final backstop |

  MCP server (`fc_check`, `fc_rules_for(file)`) deferred to phase 2.
- **D8** — Design quality via page-level structure, not per-component prompting:
  1. **Page templates** in the registry: `ListPage`, `DetailPage`, `FormPage`, `SettingsPage`, `DashboardPage`, `AuthPage` (fixed header, content max-width, gutters, action placement, spacing rhythm). `fc/page-template` requires every `app/**/page.tsx` to render a template at its root; `fc new page <name> --template <t>` scaffolds. Marketing/landing routes opt out via `scope`. SaaS/admin templates first.
  2. **Strict tokens**: spacing scale only, fixed control heights, no arbitrary Tailwind values, no off-contract shadows/gradients.
  3. **Anti-slop rules** in `baseline` (why + do/don't): one primary action per region, no card-in-card, no decorative heading icons, no emoji in UI, one h1 per page — lint where countable, prompt otherwise.

_Design still in progress._

## License

TBD
