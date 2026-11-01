# Benchmark summary (2026-11-01)

Claude Code, headless, ≈ $15 in total. Variants: `none` (no rules), `design-md` (prose rules referenced from
CLAUDE.md), `fcs` (contract + generated agent files + locked components + lint + hooks). Numbers below use the final
scorer (all runs rescored; earlier result files carry notes where the first scoring was wrong).

| task | model | what it tests | none | design-md | fcs |
|---|---|---|---|---|---|
| notes-form (1 run) | sonnet | textarea not resizable | resizable | ok | ok |
| cross-session-loading | sonnet | same loading pattern on 2 screens built in 2 sessions | consistent (skeleton) | consistent | consistent |
| drift-seeded-loading | sonnet | legacy screens disagree (spinner vs skeleton) | copied skeleton 3/3 | copied skeleton 3/3 | fcs 3/3 |
| against-prior | sonnet | project picks spinner + no textarea resize (against model defaults) | 0/6 screens, resizable 3/3 | 6/6, ok | 6/6, ok |
| long-design-md | sonnet | same, rules buried in a 52-rule DESIGN.md | 0/12, resizable 3/3 | 12/12, ok | 12/12, ok |
| long-design-md | haiku | same, weaker model | – | 12/12, ok | 12/12, ok |
| conflicting-design-md | sonnet | DESIGN.md contradicts itself on loading | – | **skeleton in 1 of 3 runs** | 3/3 contract |

## What this shows

1. Without rules, the model's defaults win every time (skeleton, resizable textarea). That is the drift users see.
2. A clear prose DESIGN.md — even 52 rules long, even on Haiku — gets the same visible result as fcs in these tasks.
3. **When the guidelines contradict themselves, the outcome depends on the run**; fcs is stable because the decision
   is made once, in a validated contract. Real DESIGN.md files often contain such contradictions.
4. fcs always removes convention drift (0 violations: same components, accessibility, delay), which prose does not:
   design-md runs re-implement spinners and textareas per project.

## Not yet tested

Codex / Cursor, very long sessions with context compaction, vague prompts, rules no component can enforce.
