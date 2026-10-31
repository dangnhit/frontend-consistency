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

_Design still in progress._

## License

TBD
