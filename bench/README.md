# bench

Measures whether frontend-consistency reduces UI drift in agent-generated code (decision D11).

- `fixture/` — Next.js 16 + shadcn (base-nova) app. Its `components.json` points the `@fcs` registry
  namespace at `http://localhost:4173/r/{name}.json`; serve it with
  `pnpm --filter @frontend-consistency/registry build && python3 -m http.server 4173 --directory registry/public`.
- `tasks/*.md` — one prompt per task. A `---session---` line splits a task into prompts run as separate agent
  sessions on the same project copy (used to measure cross-session consistency).

## Running

```bash
pnpm build                                   # build packages used by the fixture
node bench/run.mjs --runs 3                  # all tasks × {none, design-md, fcs} × 3 runs
node bench/run.mjs --tasks notes-form --variants none,fcs --runs 1
```

Variants:

| variant | what the agent sees |
|---|---|
| `none` | plain Next + shadcn app; no rules |
| `design-md` | same + a prose `DESIGN.md` stating the rules, referenced from `CLAUDE.md` |
| `fcs` | full setup: contract, generated agent files, locked `@fcs` components, Claude Code hooks |

Agents run headless with `--setting-sources project --strict-mcp-config`, so user-level plugins, hooks and MCP servers
do not leak in. Every run is scored against the fixture contract with `fcs check`, regardless of variant.
Results go to `bench/results/`.
