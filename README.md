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

_Design still in progress._

## License

TBD
