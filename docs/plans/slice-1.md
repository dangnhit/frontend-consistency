# Slice 1 — `forms.textarea.resize` end-to-end

Goal: prove every layer works for one rule before scaling. Done = a Claude Code agent asked to "add a notes form" in the fixture app produces a `<TextareaField>` with no resize handle, and if it writes a raw `<textarea>` it is told why and fixes it within the same turn.

## Tasks

### T1 — Monorepo scaffold
- pnpm workspace, Turborepo, shared tsconfig, tsup, vitest, Changesets, MIT LICENSE.
- Packages: `core`, `cli`, `eslint-plugin`, `preset-baseline`.
- Accept: `pnpm build && pnpm test` green on empty packages.

### T2 — `core`: schema, loader, resolver
- zod schema for rule + contract (§3.1–3.2 of spec; `scope`, `params`, `exceptions`, `supersedes` included now, even if lightly used).
- Load preset + `.design/rules/*.yaml` + `contract.yaml`; resolve with override precedence.
- Validation errors: unknown override id, duplicate id, invalid param.
- Accept: unit tests for precedence, override of `params.resize`, invalid contract messages.

### T3 — `preset-baseline`: first rule
- `rules/forms.yaml` containing `forms.textarea.resize` with why, do/don't, enforce.

### T4 — `core`: generators
- Marked-region writer (idempotent, preserves user content).
- Targets: `CLAUDE.md`, `AGENTS.md`, `DESIGN.md`, `.cursor/rules/fcs.mdc`, `components/fcs/contract.generated.ts`.
- Accept: snapshot tests; second run produces no diff; user text outside markers untouched.

### T5 — `eslint-plugin`: `fcs/no-raw-textarea`
- Flags JSX `<textarea>` outside `components/fcs/**`; flags `resize-*` classes when `params.resize = none`.
- Reads resolved contract (severity, exceptions by path).
- Message format per spec §6.
- `fcs.configs.recommended` flat config.
- Accept: RuleTester cases — raw textarea, allowed path, exception path, overridden severity.

### T6 — `registry`: `@fcs/textarea-field`
- shadcn registry item built on the project's `Textarea` + `Label`; label required at type level; reads `resize` from `contract.generated.ts`.
- Registry build to static JSON.
- Accept: `npx shadcn add` into fixture installs to `components/fcs/textarea-field.tsx`.

### T7 — `cli`: `init`, `build`, `check`
- `init`: create `.design/`, add `@fcs` registry to `components.json`, append ESLint preset, write lock.json after install, detect `.claude/` and install hooks.
- `check`: contract validation + lock hashes + ESLint (`--files`, `--format agent|pretty`).
- Accept: integration test on a temp copy of the fixture.

### T8 — Claude Code hooks
- `PreToolUse` deny on `components/fcs/**` (except generated file).
- `PostToolUse` on `Edit|Write|MultiEdit` → `fcs check --files <path> --format agent`, exit 2 with message on violation.
- Accept: scripted hook invocation with sample stdin JSON returns exit 2 + expected stderr.

### T9 — Bench fixture + first task
- `bench/fixture`: minimal Next 16 + shadcn app.
- Task `notes-form`; runner executes Claude Code headless (`claude -p`) under `{none, design-md, fcs}` × 3 runs; scorer counts raw textareas, resize classes, `fcs/*` violations.
- Accept: report table produced locally.

## Order

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9. T5 and T6 can run in parallel after T4.

## Open items to verify during implementation

- Exact shadcn registry namespace config shape in `components.json` for the installed shadcn version.
- Codex / Pi native hook support (else instruction-only per spec §7).
- Cursor `afterFileEdit` capabilities.
