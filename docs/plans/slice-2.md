# Slice 2 — `loading.page` + `AsyncBoundary`

Goal: the "spinner on screen A, skeleton on screen B" drift disappears. Every page- or section-level loading state
renders through one locked component, and the contract (not the agent) decides whether that state is a skeleton or a
spinner. Done = two screens built by two separate agent sessions show the same loading pattern, and an agent that
writes `if (isLoading) return <Loader2 className="animate-spin" />` is told to use `<PageSkeleton>` and fixes it.

New ground this slice covers vs. slice 1: a **conditional** rule (param switches the rendered pattern), a Next file
convention (`loading.tsx`), and a cross-session benchmark that measures consistency instead of a single violation.

## Rule

```yaml
- id: loading.page
  title: Page and section loading uses the contract's loading pattern
  params:
    pattern: skeleton        # skeleton | spinner
    delayMs: 300             # don't show a loading state for fast loads (avoids flash)
  enforce:
    component: "@fcs/async-boundary"
    lint: [fcs/no-ad-hoc-loading]
```

Spinners stay legitimate inside buttons (in-flight action) — that belongs to `SubmitButton` in a later slice.

## Tasks

### T1 — Preset rule `rules/loading.yaml`
- why / do / don't covering: Suspense, `loading.tsx`, client `isLoading` branches.

### T2 — Registry `@fcs/async-boundary`
- `AsyncBoundary`: Suspense + error boundary; `skeleton` prop picks a shape (`list | detail | form | cards | table`);
  error state with retry, never rendered as empty/zero.
- `PageSkeleton`: the same shapes for client `isLoading` branches and `loading.tsx`.
- Pattern and delay come from `ruleParams("loading.page")`.
- Built on the project's shadcn `Skeleton`.

### T3 — Lint `fcs/no-ad-hoc-loading`
Reports, outside `components/fcs/**` and the primitives dir:
- `<Suspense>` from `react` → use `<AsyncBoundary>`.
- shadcn `Skeleton` imported from the primitives dir → use `<PageSkeleton>`.
- `animate-spin`, or lucide `Loader*` icons, not inside a `*Button` element.
- standalone JSX text `Loading…` / `Loading...`.
- `app/**/loading.tsx` that does not render `<PageSkeleton>`.

### T4 — Generated docs + CLI
- `fcs add async-boundary` locks the new files; rules markdown shows the new rule; `fcs check` covers it.

### T5 — Bench task `cross-session-loading`
- Two prompts run in **separate** sessions on the same project copy: "Customers list page" then "Customer detail page",
  both with async data.
- Score: loading pattern per screen (skeleton / spinner / text / none), `fcs/*` violations, and **consistent = both
  screens use the same pattern**.

## Order

T1 → T2 → T3 → T4 → T5. T2 and T3 can run in parallel after T1.
