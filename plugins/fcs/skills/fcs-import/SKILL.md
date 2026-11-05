---
name: fcs-import
description: Import an existing DESIGN.md (or any markdown UI guidelines) into the fcs contract. Finds statements about loading states, textarea resizing, breadcrumbs and similar rules, reports contradictions with line numbers, and writes the chosen values as enforced contract params. Use when the user has a DESIGN.md, style guide or UI rules doc and fcs is set up.
---

# Import a design doc into fcs

`npx fcs import` is deterministic (regex detectors, no LLM). Your job is to run it, settle conflicts with the user, and clean up the prose.

## 1. Report

```sh
npx fcs import DESIGN.md
```

The output has three parts:

- **FOUND** `<rule>.<param> = <value>`: the doc agrees on one value.
- **CONFLICT** `<rule>.<param>`: the doc argues for several values. Each value is listed with its `file:line` and quote.
- A count of statements that stay prose. These are not enforced, which is fine; they still reach agents through the doc.

If the command fails because `.design/contract.yaml` is missing, run the `fcs-setup` skill first.

## 2. Settle conflicts with the user

For each CONFLICT, show the user the competing lines and ask which value the team wants. Do not pick one yourself, even if one looks better. Contradictory prose is the reason screens drift.

## 3. Write

```sh
npx fcs import DESIGN.md --decide loading.page.pattern=skeleton --decide layout.page-header.breadcrumb=nested --write
```

This writes overrides into `.design/contract.yaml` and records the decision in `.design/decisions/NNNN-import-*.md`. It then rebuilds the generated agent files and `components/fcs/contract.generated.ts`. The command exits 1 while any conflict is undecided.

## 4. Fix the prose

The output lists losing lines under "update or delete these lines in DESIGN.md". Agents read those lines as instructions, so edit them so the doc says one thing, the same thing the contract says. Show the user the diff.

## 5. Verify

```sh
npx fcs check
```
