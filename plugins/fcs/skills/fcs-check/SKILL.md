---
name: fcs-check
description: Run the fcs UI contract check and fix the violations it reports (raw textarea, hand-made spinner, page without the template, missing breadcrumb, hand-written h1, edited locked component). Use when fcs check, a fcs hook, pre-commit or CI reports "UI contract violations", or before finishing UI work in a project with .design/contract.yaml.
---

# Fix fcs contract violations

## 1. Run

```sh
npx fcs check --format agent            # whole project
npx fcs check --format agent app/x.tsx  # specific files
```

Each error names the rule id, the current param value, and the component to use instead.

## 2. Fix by replacing, never by silencing

| Error | Fix |
| --- | --- |
| `fcs/no-disable` | remove the `eslint-disable` comment and fix the underlying error |
| `fcs/no-raw-textarea` | `<TextareaField>` from `@/components/fcs/textarea-field` |
| `fcs/no-ad-hoc-loading` | `<AsyncBoundary>` (or `PageSkeleton` in `loading.tsx`) from `@/components/fcs/async-boundary` |
| `fcs/page-template` | return `<Page>` or `<ListPage>` as the page's root; move the old wrapper's content inside it |
| `fcs/page-header` (h1) | pass the text as `title=` to the template |
| `fcs/page-header` (breadcrumb missing) | pass `breadcrumbs={[{ label, href }, …, { label: current }]}`; the last crumb has no `href` |
| lock / hash mismatch on `components/fcs/*` | restore the file with `git checkout -- <file>`; change behaviour through `.design/contract.yaml` params, then `npx fcs build` |
| generated files out of date | `npx fcs build` |

Rules you must not break:

- Do not add `eslint-disable` comments.
- Do not edit `components/fcs/**`, `.design/lock.json` or `contract.generated.ts`.
- Do not change rule severity in `.design/contract.yaml` to get a pass.

## 3. When the rule seems wrong

If a contract rule blocks something the user really needs, stop and ask the user. The right fix is a deliberate contract change: an override in `.design/contract.yaml` plus a note in `.design/decisions/`. A workaround is not.

## 4. Re-run

Re-run `npx fcs check` (without `--format agent`) until it prints `contract satisfied ✓`.
