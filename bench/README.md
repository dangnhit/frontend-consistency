# bench

Measures whether frontend-consistency reduces UI drift in agent-generated code (decision D11).

- `fixture/` — Next.js 16 + shadcn (base-nova) app. Its `components.json` points the `@fcs` registry
  namespace at `http://localhost:4173/r/{name}.json`; serve it with
  `pnpm --filter @frontend-consistency/registry build && python3 -m http.server 4173 --directory registry/public`.
- Task runner and scorer: added in slice-1 T9.
