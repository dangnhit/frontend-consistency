---
"@gwinnguyen/fcs": minor
---

v0.2 S3 — baseline for existing code: `fcs baseline` (human-only) accepts current violations per file and rule/pattern; `fcs check` fails only on growth (`--no-baseline` shows all); full checks ratchet counts down; the post-edit hook nudges agents about accepted violations via `additionalContext` instead of blocking; agents cannot edit `.design/baseline.json`.
