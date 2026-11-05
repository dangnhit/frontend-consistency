---
"@gwinnguyen/fcs": minor
---

Codex support: `fcs init --codex` installs `.codex/hooks.json` (PreToolUse / PostToolUse on `apply_patch`, Stop). `fcs hook` reads Codex `apply_patch` payloads and finds the project root by walking up to `.design/`.
