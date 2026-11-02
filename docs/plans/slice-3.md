# Slice 3 — page templates + `PageHeader` (breadcrumb)

Goal: every screen has the same frame. A page's title, breadcrumb, primary action, gutters and max width come from one
locked template, so "screen C has a breadcrumb, screen D does not" and "this page is `max-w-5xl px-6`, that one
`container py-10`" stop happening. Done = two list/detail screens built in separate sessions share the template, and
a nested route without a breadcrumb is told to add one.

New ground vs. slices 1–2: a **page-level** rule (checks the shape of `app/**/page.tsx`, not an element), a rule whose
param depends on **route depth**, and a scaffold command (`fcs new page`).

## Rules

```yaml
- id: layout.page-template
  params: {}
  enforce: { component: "@fcs/page", lint: [fcs/page-template] }

- id: layout.page-header
  params:
    breadcrumb: nested   # always | nested | never
  enforce: { component: "@fcs/page", lint: [fcs/page-header] }
```

- `layout.page-template`: the default export of every `app/**/page.tsx` returns a template from `components/fcs`
  (`<Page>` or `<ListPage>`) as its root element. Client views go inside the template. Marketing routes opt out with
  `scope` + an override.
- `layout.page-header`: page titles are rendered only by the template (no `<h1>` outside `components/fcs` and
  primitives); shadcn `Breadcrumb*` primitives are not composed by hand; `breadcrumbs` is required on nested routes
  (`nested`: route depth ≥ 2 after dropping `(groups)` and `@slots`; `always`: every page except `/`; `never`:
  forbidden).

Both rules carry `detect:` so `fcs import` maps prose about breadcrumbs onto `breadcrumb`.

## Tasks

- T1 — preset `rules/layout.yaml` (why / do / don't / detect).
- T2 — registry `@fcs/page` (`Page`, `PageHeader`, `Crumb`) and `@fcs/list-page` (`ListPage`: header + toolbar slot
  + content). Built on the shadcn `breadcrumb` primitive; container width, gutters, spacing fixed in the template;
  breadcrumb behaviour from `ruleParams("layout.page-header")`.
- T3 — lint `fcs/page-template`, `fcs/page-header`.
- T4 — `fcs new page <route> [--template page|list] [--title …]`: writes `page.tsx` (template, breadcrumbs derived from
  the route, awaited `params` for dynamic segments) and `loading.tsx` (`PageSkeleton`).
- T5 — fixture: breadcrumb primitive, new components locked, home page on `<Page>`.
- T6 — bench task `cross-session-header` (list page, then nested detail page, separate sessions). Run only after
  confirmation (token cost).
