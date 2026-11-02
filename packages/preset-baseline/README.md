# @frontend-consistency/preset-baseline

Baseline rule preset for [frontend-consistency](https://github.com/dangnhit/frontend-consistency): shadcn visuals,
measurable, standards-based defaults. Rules live in `rules/*.yaml`:

- `forms.textarea.resize`: textareas are not user-resizable (`resize: none | vertical`)
- `loading.page`: one loading pattern for pages and sections (`pattern: skeleton | spinner`, `delayMs`)
- `layout.page-template`: every page renders a page template (`contentWidth`)
- `layout.page-header`: titles and breadcrumbs come from the template (`breadcrumb: always | nested | never`)

Use with `extends: "@frontend-consistency/preset-baseline"` in `.design/contract.yaml`; override params there.
