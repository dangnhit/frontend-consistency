# @gwinnguyen/fcs

`fcs` keeps AI-generated UI consistent across screens, sessions and agents (Claude Code, Codex, Cursor) in
Next.js App Router + shadcn/ui + Tailwind projects. Decisions such as "skeleton or spinner", "breadcrumbs on nested
pages" or "textareas are not resizable" live once in `.design/`. Agents read them from generated files, use locked
components that implement them, and get lint errors fed back after every edit.

> Pre-release (`next` tag). APIs and rule ids may change.

## Quick start

```sh
npx shadcn@latest init                     # if the project has no components.json yet
npm i -D @gwinnguyen/fcs@next @gwinnguyen/eslint-plugin-fcs@next @gwinnguyen/fcs-preset-baseline@next
npx fcs init --claude                      # .design/, @fcs registry, ESLint wiring, Claude Code hooks
npx fcs add textarea-field async-boundary page list-page
npx fcs check
```

Already have a DESIGN.md? Map it onto the contract and settle its contradictions:

```sh
npx fcs import DESIGN.md                                   # report: agreed values, conflicts with line numbers
npx fcs import DESIGN.md --decide loading.page.pattern=spinner --write
```

## Commands

| command | does |
|---|---|
| `fcs init [--claude]` | scaffold `.design/`, add the `@fcs` shadcn registry, wire ESLint, install agent hooks |
| `fcs build` | generate `AGENTS.md` / `CLAUDE.md` / `DESIGN.md` blocks and `components/fcs/contract.generated.ts` |
| `fcs check [files…]` | validate the contract, verify locked components, run `fcs/*` lint |
| `fcs add <component…>` | install `@fcs` components and lock them |
| `fcs import <DESIGN.md>` | map prose rules onto contract params, report conflicts; `--decide`, `--write` |
| `fcs new page <route> [--template page\|list]` | scaffold `page.tsx` + `loading.tsx` on a page template |
| `fcs hook pre\|post\|stop` | Claude Code hook entry points (installed by `fcs init`) |

Change a decision in `.design/contract.yaml`:

```yaml
extends: "@gwinnguyen/fcs-preset-baseline"
overrides:
  loading.page:
    params: { pattern: spinner }
  layout.page-header:
    params: { breadcrumb: always }
```

then `npx fcs build`. See the [repository](https://github.com/dangnhit/frontend-consistency) for the design, rules and
benchmarks.
