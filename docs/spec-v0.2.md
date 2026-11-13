# frontend-consistency — Specification v0.2: bring your own patterns

Status: accepted (Q1–Q7 as recommended). Supersedes the "fcs ships the answer" parts of [spec.md](spec.md) (v1). Engine, hooks,
`fcs import` and the lock stay.

## 1. Why v0.2

v1 decides **what the UI looks like**:

- `<Page>` from the fcs registry
- skeleton loading
- breadcrumbs on nested routes

A project must adopt fcs's design to get consistency. That works for a fresh admin app and fails everywhere else: a
product like an app builder, an editor, a marketing site, or an existing codebase with its own components.

v0.2 splits the two concerns:

| | Who owns it | Example |
|---|---|---|
| **Concern catalog**: *which* UI decisions AI agents tend to make inconsistently, and how to recognise them in code | fcs | "loading state": spinner icons, `animate-spin`, `Skeleton`, "Loading…" text |
| **Patterns**: *how* this project solves each concern | the project | "loading = `<LoadingState>` from `components/app/loading-state.tsx`; never `Loader2`" |

> fcs knows where agents drift. The project decides what is right. fcs keeps every agent doing it that way.

### Goals

1. Any look, any layout, any component library inside React/TSX. fcs never requires a component of its own.
2. Works on existing codebases first. Patterns are discovered from the code (`fcs scan`), not written from scratch.
3. A concern with no decision yet gets one the first time it is implemented, then never gets a second variant.
4. Keep v1's enforcement: generated agent context, locked canonical components, lint, Claude Code and Codex hooks, CI.

### Non-goals (v0.2)

- Visual similarity that has no code signature, such as two hand-built cards that look different. That needs the phase 2 screenshot audit.
- Non-React stacks.
- Generating a design from a brief. A pipeline that does this (for example an app builder) can write `patterns:` itself.

## 2. Concepts

- **Concern**: a recurring UI decision. Catalog entries have an id (`loading`, `confirm`, `page-frame`…), a title, a
  `why`, and **signals**.
- **Signal**: a code matcher that marks an occurrence of the concern. Kinds:

  | Kind | Example |
  |---|---|
  | `import` | `lucide-react#Loader2`, `@/components/ui/alert-dialog` |
  | `element` | `textarea`, `h1` |
  | `className` | token or regex, e.g. `animate-spin`, `^max-w-` |
  | `call` | `window.confirm`, `toast`, `toLocaleString` |
  | `text` | JSX text regex, e.g. `^Loading\.{0,3}$` |
  | `root` | the root JSX element of a file matching a glob (page frame) |

- **Variant**: one way a concern is implemented in this codebase. It is either a raw signal (e.g. `Loader2 + animate-spin`)
  or a **wrapper**. A wrapper is a component file that contains signals, is exported, and is imported from at least 2
  other files. Usages of the wrapper count as the wrapper's variant, not the raw signal.
- **Pattern**: the project's decision for a concern. It names the canonical implementation(s) and forbids the rest.

## 3. Contract

`.design/contract.yaml` gains `patterns:`; `extends:` and presets become optional.

```yaml
patterns:
  loading:                                   # pattern id; concern defaults to the id
    use: "@/components/app/loading-state#LoadingState"
    forbid:
      - import: "lucide-react#Loader2"
      - className: "animate-spin"
      - text: "^Loading\\.{0,3}$"
    why: One loading look across the app; LoadingState handles delay and skeleton shape.

  page-frame:
    files: "app/**/page.tsx"
    root:
      - "@/components/layout/app-page#AppPage"
      - "@/components/layout/editor-shell#EditorShell"

  marketing-frame:                           # same concern, different scope
    concern: page-frame
    files: "app/(marketing)/**/page.tsx"
    root: ["@/components/marketing/section-page#SectionPage"]

  confirm:
    use: "@/components/app/confirm-dialog#ConfirmDialog"
    forbid:
      - call: "window.confirm"
      - import: "@/components/ui/alert-dialog"
    status: proposed                         # added by an agent, awaiting a human (§6)

tokens:
  arbitrary: forbid                          # p-[13px], text-[#3b82f6], rounded-[7px]
  allow: ["grid-cols-[*]"]                   # escape hatches
```

Rules:

- `use` / `root` accept one or more `module#Export` refs. The files that define them are exempt from their own
  `forbid`; `LoadingState` may import `Skeleton`.
- `forbid` defaults to the catalog's signals for that concern, minus whatever `use` resolves to. Writing `forbid`
  overrides the default.
- `files` / `except` are globs that scope a pattern. When several patterns share a concern, the most specific `files`
  wins.
- `severity: error | warn | off` (default `error`).
- `status: decided | proposed` (default `decided`). Both statuses are enforced; `proposed` is also listed by `fcs check` until
  confirmed (§6).
- Canonical components are added to `.design/lock.json` by default (`lock: false` to opt out), so agents cannot "fix"
  the shared component for one screen.

v1 rules (`rules/*.yaml` with `params`, `detect`) keep working. The baseline preset is re-expressed as `patterns:`
pointing at `@/components/fcs/*` and becomes an optional starter for new projects.

## 4. Enforcement

### 4.1 Lint: one generic rule

`fcs/pattern` reads `patterns:` and reports every forbidden signal or wrong root in scope:

```
app/billing/page.tsx:14:9  error  fcs/pattern(loading): use <LoadingState> from @/components/app/loading-state
  instead of Loader2 + animate-spin. Used the project way in 12 files. — .design/contract.yaml
```

`fcs/tokens` reports arbitrary Tailwind values and inline hex colors unless allowed. The v1 rules (`no-raw-textarea`,
`page-template`, `page-header`, `no-ad-hoc-loading`) become presets of `fcs/pattern` and stay as aliases. `no-disable`
stays.

### 4.2 Baseline for existing code

Adopting fcs on a real codebase must not fail CI on day one.

- `fcs baseline` writes `.design/baseline.json` with per-file, per-pattern violation counts.
- `fcs check` fails only when a count goes **up**, or appears in a file that had none.
- Counts that go down are rewritten automatically, so the ratchet only tightens.
- Hooks tell the agent about baselined violations in the file it edited as "existing, optional to fix". They do not
  block on them, so a one-line change never turns into a refactor.

### 4.3 Lock for project files

```sh
fcs lock components/app/loading-state.tsx     # agents blocked by the PreToolUse hook
fcs lock --update components/app/loading-state.tsx --reason "add inline variant"   # human edit, recorded in decisions/
fcs unlock components/app/loading-state.tsx
```

Same hash lock as v1, for any file, not only registry installs. `fcs eject <component>` moves a registry component under
project ownership: copy, re-lock, record.

### 4.4 Agent context

The generated `AGENTS.md` / `CLAUDE.md` section lists one line per pattern, using the project's names, plus the
first-use protocol:

```
Loading → <LoadingState> (@/components/app/loading-state). Never Loader2, animate-spin, "Loading…" text.
Confirm → <ConfirmDialog> (@/components/app/confirm-dialog). Never window.confirm. [proposed]
Page frame (app/**/page.tsx) → root is <AppPage> or <EditorShell>.
No pattern yet: toast, empty-state, date-format. First time you implement one: build it as a shared component, then
run `npx fcs adopt <concern> <module#Export>`.
```

Hooks are unchanged from v1 (pre: lock; post: lint the edited file; stop: check changed files). They now run
`fcs/pattern`, `fcs/tokens` and the first-use detector.

## 5. `fcs scan`: discover patterns in existing code

```sh
fcs scan                       # report
fcs scan --decide loading=A --decide confirm=B --write
```

Report:

```
loading — 3 variants
  A  <LoadingState> @/components/app/loading-state   12 files   last change 2d ago   ← suggested (most used)
  B  Loader2 + animate-spin                           5 files   app/billing/page.tsx:14, …
  C  "Loading..." text                                1 file    app/settings/page.tsx:40
confirm — 1 variant (already consistent)
  A  <ConfirmDialog> @/components/app/confirm-dialog   6 files   ← adopt as-is
page-frame (app/**/page.tsx) — 4 variants
  A  <AppShell> …                                      9 files
  B  <main className="mx-auto max-w-5xl …">            3 files
  …
not found in code: toast, empty-state
```

Algorithm, deterministic, no LLM:

1. Parse every `*.tsx/jsx/ts/js` file in scope with the ESLint TS parser. Record signal occurrences per concern.
2. Build the import graph and promote wrappers (§2). A wrapper's importers count as the wrapper's variant.
3. Group the remaining raw occurrences into variants by signal signature.
4. Suggest a variant by usage count, with recency as the tie-breaker. **Never auto-decide when 2 or more variants exist.**
5. `--write` adds the patterns to the contract, locks canonical components, writes
   `.design/decisions/NNNN-scan.md`, runs `fcs baseline` for the losing variants, and rebuilds agent files.

`fcs import DESIGN.md` maps prose onto the same concern ids, so a doc and a scan can be compared: "DESIGN.md says
skeleton, the code uses spinners in 5 files".

## 6. First-use protocol (concerns with no pattern)

The detector flags an edit that introduces signals of a concern that has no pattern.

1. The post/stop hook tells the agent: no project pattern exists for this concern. Search the code for an existing one;
   otherwise build it as one shared component and run `npx fcs adopt <concern> <module#Export>`.
2. `fcs adopt` writes the pattern with `status: proposed` and locks the component. From then on it is enforced like any
   other pattern, so a second variant cannot appear, even later in the same session.
3. `fcs check` / `fcs review` lists proposed patterns. A human confirms (`status: decided`), or replaces them with
   `fcs adopt --replace`, which tells the agent to migrate usages.

## 6a. Several apps in one repo

One repo often holds apps that are meant to differ, for example an admin portal and a studio. Consistency is required
**within** an app and for shared code, not across apps.

**Monorepo: one `.design/` per app, layered.**

```
.design/contract.yaml              shared: tokens, date-format, confirm, toast (from packages/ui)
apps/admin/.design/contract.yaml   extends: ../../../.design  + admin patterns
apps/studio/.design/contract.yaml  extends: ../../../.design  + studio patterns
```

```yaml
# apps/studio/.design/contract.yaml
extends: ../../../.design
patterns:
  page-frame:
    files: "app/**/page.tsx"
    root: ["@/components/studio-shell#StudioShell"]
  loading:
    use: "@/components/canvas-loading#CanvasLoading"
    reason: Studio loads canvases; needs progress, not a skeleton
```

- A child contract may add patterns and may override a parent pattern with the same id. An override requires `reason`,
  which is recorded in `decisions/`.
- Hooks and `fcs check` resolve the nearest `.design/` above the edited file. They already walk up, so no extra config is needed.
- `fcs build` writes agent context per app (`apps/studio/AGENTS.md`, `CLAUDE.md`). Claude Code and Codex read nested
  files, so an agent working in the studio sees studio patterns plus shared ones.
- The root contract owns shared packages (`packages/ui`, …).

**Single app: route groups.** Use `scopes` and scope patterns that share a concern:

```yaml
scopes:
  admin:  { include: ["app/(admin)/**", "components/admin/**"] }
  studio: { include: ["app/(studio)/**", "components/studio/**"] }
patterns:
  admin-frame:  { concern: page-frame, scope: admin,  root: ["@/components/admin/admin-page#AdminPage"] }
  studio-frame: { concern: page-frame, scope: studio, root: ["@/components/studio/studio-shell#StudioShell"] }
  confirm:      { use: "@/components/ui/confirm-dialog#ConfirmDialog" }   # no scope = whole repo
```

**Scan is scope-aware.** It reports each variant's distribution per app or scope:

```
loading — 2 variants
  A  <TableSkeleton>   14 files   apps/admin 14 · apps/studio 0
  B  <CanvasLoading>    6 files   apps/admin 0  · apps/studio 6
  → each app uses exactly one variant: suggest one pattern per app (no question asked)
  → for one shared pattern instead: --decide loading=A
```

Mixed variants **within** one app or scope are drift and need `--decide`. Variants that split cleanly along app
boundaries are treated as intentional by default.

## 7. Concern catalog v0.2

It ships in `@gwinnguyen/fcs-core` (`concerns/*.yaml`) and can be extended per project in `.design/concerns/`.

| id | signals (default forbid when a pattern exists) |
|---|---|
| `loading` | spinner icons (lucide/heroicons/react-icons `Loader*`, `Spinner`), `animate-spin`, `Skeleton`, "Loading…" text |
| `confirm` | `window.confirm`, `AlertDialog*`, `Dialog` containing a destructive button |
| `toast` | `toast(`, `sonner`, `react-hot-toast`, `alert(` |
| `empty-state` | JSX text "No … yet/found", bare empty `<div>` in a list branch |
| `error-display` | `text-destructive`/`text-red-*` paragraphs, `Alert variant="destructive"` |
| `page-frame` | root element of route files (`app/**/page.tsx`, `pages/**`, configurable) |
| `page-title` | `<h1>` outside the frame component |
| `breadcrumb` | `Breadcrumb*`, "← Back" links |
| `text-input` | `<input>`, `<textarea>`, `<select>` outside the field component |
| `icon-set` | imports from more than one icon library |
| `date-format` | `toLocaleDateString`, `Intl.DateTimeFormat`, `date-fns#format`, `dayjs().format` |
| `money-format` | `Intl.NumberFormat` with currency, `toFixed(2)` next to a currency symbol |

`fcs/tokens` covers arbitrary values separately.

## 8. Delivery slices

| Slice | Content | Done when |
|---|---|---|
| S1 | `patterns:` schema, `fcs/pattern`, wrapper-aware forbid, AGENTS.md lines, baseline preset re-expressed as patterns, layered contracts (`extends` a parent `.design/`, override with `reason`) and scoped patterns | v1 tests pass on the new engine; a fixture with a custom `<LoadingState>` is enforced; a 2-app fixture enforces different frames per app |
| S2 | `fcs lock/unlock/--update`, `fcs eject` | agent edit to a project component blocked by the hook; human update recorded |
| S3 | `fcs baseline` + ratchet | existing project with violations: CI passes, a new violation fails |
| S4 | concern catalog + `fcs scan` (+ `--decide --write`) | on a real codebase, the report matches a manual audit of 3 concerns |
| S5 | first-use protocol + `fcs adopt` / `fcs review` | bench: concern with no pattern, 3 sessions → 1 variant |
| S6 | `fcs/tokens` | arbitrary values reported; allow-list works |
| S7 | dogfood on a real project; bench task "existing codebase" | written results |

## 9. Decisions (accepted)

| # | Question | Recommendation |
|---|---|---|
| Q1 | May an agent run `fcs adopt` (set a project pattern) without a human? | Yes, as `proposed`, enforced immediately, listed until confirmed. Consistency within a session matters more than waiting for a human. |
| Q2 | Lock canonical components by default? | Yes. An agent "fixing" the shared component for one screen is the most damaging drift. |
| Q3 | Baselined violations in a file the agent edits: block, nudge, or ignore? | Nudge (shown, not blocking). |
| Q4 | `scan` suggests by usage count or recency? | Count, with recency as tie-breaker; never auto-decide when 2 or more variants exist. |
| Q5 | Keep the fcs registry and components? | Yes, as an optional starter and examples; nothing requires them. |
| Q6 | Where does the catalog live? | Core package, extendable per project (`.design/concerns/*.yaml`) and by presets. |
| Q7 | A concern solved differently in two apps of one repo: drift or intentional? | Intentional when each app uses exactly one variant; suggest per-app patterns. Ask only when variants mix within one app. Root patterns apply to every app unless the app overrides them with a `reason`. |
