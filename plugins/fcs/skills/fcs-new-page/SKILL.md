---
name: fcs-new-page
description: Create a new Next.js App Router page on the project's locked fcs page template, with the breadcrumb, title, gutters and loading skeleton the contract requires. Use whenever adding a new screen, route or page in a project that has a .design/contract.yaml.
---

# New page on the fcs template

Scaffold first, then fill in content. Do not hand-write the page frame: no `<main className=…>`, no `<h1>`, no hand-built breadcrumb.

## 1. Scaffold

```sh
npx fcs new page <route> [--template page|list] [--title "<Title>"]
```

Choose the template:

- `--template list` for index screens: a table or cards, with an optional filter toolbar.
- `--template page` (the default) for detail, form, settings and everything else.

Routes use App Router syntax:

- `customers`
- `customers/[id]`
- `customers/[id]/edit`
- `(admin)/settings`
- `docs/[...slug]`

The command writes `page.tsx` and `loading.tsx`. It adds breadcrumbs when the contract requires them for that route depth, and awaits `params` for dynamic segments. If the page already exists it refuses. In that case, edit the existing page instead.

## 2. Fill in content

- Replace the `{/* content */}` placeholder, and for list pages the `toolbar` prop. For a detail page, replace the param-based title and the crumb label with the real record name once you fetch it.
- Keep `<Page>` / `<ListPage>` from `@/components/fcs/...` as the root element. Client components go inside it.
- Actions go in the `actions` prop: the primary button sits in the header, top right.
- Multi-line input uses `<TextareaField>` from `@/components/fcs/textarea-field`, not `<textarea>` or the `ui/textarea` primitive.
- Async sections use `<AsyncBoundary skeleton="list|detail|…">` from `@/components/fcs/async-boundary`, not hand-made spinners or skeletons.
- Read the generated contract section in `AGENTS.md` / `CLAUDE.md` for the full rule list and the current params.

## 3. Verify

```sh
npx fcs check app/<route>/page.tsx
```

Fix every error; the `fcs-check` skill explains how. Never add `eslint-disable` comments, and never edit `components/fcs/**`.
