---
name: fcs-setup
description: Set up the fcs UI contract in a Next.js App Router + shadcn + Tailwind project so every AI-built screen uses the same loading, form, page-header and layout patterns. Use when the user asks to install or set up fcs, "frontend consistency", a UI contract, or to stop the agent from building screens inconsistently.
---

# Set up fcs

fcs is a CLI (`@gwinnguyen/fcs`). This skill only runs it; do not re-implement what it does.

## 1. Check the project

- Needs Next.js App Router, Tailwind and shadcn (`components.json` at the project root). If `components.json` is missing, ask the user before running `npx shadcn@latest init`.
- Detect the package manager from the lockfile (`pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `package-lock.json`) and use it below.

## 2. Install

```sh
npm i -D @gwinnguyen/fcs@next @gwinnguyen/eslint-plugin-fcs@next @gwinnguyen/fcs-preset-baseline@next
```

(`pnpm add -D …`, `yarn add -D …`, `bun add -d …` for other package managers.)

## 3. Initialise

Pass the flag for each agent the team uses — both is fine:

```sh
npx fcs init --claude --codex
```

This creates `.design/contract.yaml`, adds the `@fcs` registry to `components.json`, adds `fcs.config()` to the flat ESLint config, generates `AGENTS.md` / `CLAUDE.md` regions, and installs hooks:

- Claude Code: `.claude/settings.json`
- Codex: `.codex/hooks.json`

Hooks do three things: they block edits to locked files, lint each edited file, and run a full check before the agent finishes.

Do whatever the command prints under "Next:". If it could not edit the ESLint config, apply the snippet it prints.

## 4. Choose the project's patterns

**Existing codebase:** discover how each UI concern is implemented today:

```sh
npx fcs scan
```

For each concern, the report lists the variants found:

- a shared component, with its usage count, or
- a raw signal (spinner icon, `<h1>`, `window.confirm`…), with example locations.

It suggests the most used variant. When route groups such as `app/(admin)` each use a different variant, it suggests
one pattern per area. Show the report to the user and ask them to pick a variant for every concern that has more than one.

Writing the choice is a team decision. `fcs scan --write` refuses to run from an agent's shell, so give the user the
exact command to run in their terminal, for example:

```sh
npx fcs scan --decide loading=A --decide page-title@dashboard=B --write
```

Shared components that are already used consistently are adopted without a `--decide`. Existing usages of the losing
variants are baselined, so CI stays green while new code must follow the pattern.

**New project:** install fcs's starter components instead. They land in `components/fcs/` and are locked:

```sh
npx fcs add page list-page async-boundary textarea-field
```

## 5. Verify

```sh
npx fcs check
```

If an existing codebase still has violations the scan did not baseline, show the user the count. They can accept
them with `npx fcs baseline --reason "…"` (run in their terminal), or ask you to migrate. The `fcs-check` skill fixes
violations.

## 6. Tell the user

- If the project already has a `DESIGN.md` or similar UI rules, suggest the `fcs-import` skill. It maps the prose onto contract params and finds contradictions.
- **Codex users:** open Codex in the repo and approve the fcs hooks with `/hooks`. Codex skips repo hooks until they are trusted.
- Add `npx fcs check` to pre-commit and CI. It is the hard gate; hooks are the fast feedback.
