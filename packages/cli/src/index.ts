#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { ContractError } from "@gwinnguyen/fcs-core";
import { add } from "./commands/add.js";
import { build, describeBuild } from "./commands/build.js";
import { check, type Format } from "./commands/check.js";
import { findRoot, hookPost, hookPre, hookStop, type HookInput } from "./commands/hook.js";
import { importDesignDoc } from "./commands/import.js";
import { init } from "./commands/init.js";
import { assertHuman, eject, lock, unlock, updateLock } from "./commands/lock.js";
import { BASELINE_FILE, captureBaseline } from "./baseline.js";
import { recordDecision } from "./decisions.js";
import { lintContract } from "./lint.js";
import { newPage, type Template } from "./commands/new.js";

const HELP = `fcs — keep AI-generated UI consistent with your design contract

Usage:
  fcs init [--claude] [--codex] [--registry <url>]
                                           scaffold .design/, registry, ESLint, agent hooks
  fcs build                                generate agent files + components/fcs/contract.generated.ts
  fcs check [files...] [--format agent] [--no-baseline]
                                           validate contract, lock, generated files, lint (new violations only)
  fcs baseline [--reason <text>]           accept today's violations so adoption starts green; fixes ratchet it down
  fcs add <component...>                   install @fcs components and lock them
  fcs import <DESIGN.md> [--decide <rule.param=value>...] [--write]
                                           map prose rules onto contract params, report conflicts
  fcs new page <route> [--template page|list] [--title <text>]
                                           scaffold app/<route>/page.tsx + loading.tsx on a page template
  fcs lock <file...> [--reason <text>]     lock project files against agent edits (canonical components lock on build)
  fcs lock --update <file...> --reason <text>
                                           accept a deliberate human edit to a locked file (decision recorded)
  fcs unlock <file...> --reason <text>     stop locking a project file (decision recorded)
  fcs eject <component...> --reason <text> take ownership of a registry component (stays locked against agents)
  fcs hook pre|post|stop                   Claude Code / Codex hook entry (reads JSON on stdin)

Options:
  --root <dir>   project root (default: cwd)
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      format: { type: "string", default: "pretty" },
      registry: { type: "string" },
      claude: { type: "boolean", default: false },
      codex: { type: "boolean", default: false },
      decide: { type: "string", multiple: true },
      write: { type: "boolean", default: false },
      template: { type: "string" },
      title: { type: "string" },
      update: { type: "boolean", default: false },
      "no-baseline": { type: "boolean", default: false },
      reason: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, ...rest] = positionals;
  const root = path.resolve(values.root ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());

  if (values.help || !command) {
    process.stdout.write(HELP);
    return command ? 0 : 1;
  }

  switch (command) {
    case "init": {
      const r = init(root, { registry: values.registry, claude: values.claude, codex: values.codex });
      for (const d of r.done) console.log(`✓ ${d}`);
      try {
        for (const w of build(root).filter((x) => x.changed)) console.log(w.lockedFor ? describeBuild(w) : `✓ generated ${w.file}`);
      } catch (e) {
        if (!(e instanceof ContractError)) throw e;
        r.todo.unshift(`Contract not buildable yet (${e.issues[0]?.message}). Install the preset, then run \`fcs build\`.`);
      }
      if (r.todo.length) console.log(`\nNext:\n${r.todo.map((t) => `  • ${t}`).join("\n")}`);
      return 0;
    }
    case "build": {
      for (const w of build(root)) console.log(describeBuild(w));
      return 0;
    }
    case "baseline": {
      assertHuman("baseline");
      const res = captureBaseline(root, await lintContract(root));
      console.log(`✓ wrote ${BASELINE_FILE}: ${res.violations} existing violation(s) in ${res.files} file(s) accepted`);
      const decision = recordDecision(root, "baseline", [
        "# Baseline existing UI-contract violations",
        "",
        `${res.violations} violation(s) in ${res.files} file(s) accepted as of adoption. \`fcs check\` fails only when a file gains violations;`,
        "counts that drop are lowered automatically, so fixed code cannot regress.",
        ...(values.reason ? ["", values.reason] : []),
      ]);
      console.log(`✓ recorded ${decision}`);
      return 0;
    }
    case "lock": {
      assertHuman(values.update ? "lock --update" : "lock");
      const r = values.update ? updateLock(root, rest, values.reason ?? "") : lock(root, rest, values.reason);
      for (const f of r.changed) console.log(`✓ ${values.update ? "updated" : "locked"} ${f}`);
      if (!r.changed.length) console.log(values.update ? "· nothing changed since the last lock" : "· already locked");
      if (r.decision) console.log(`✓ recorded ${r.decision}`);
      return 0;
    }
    case "unlock":
    case "eject": {
      assertHuman(command);
      const r = (command === "eject" ? eject : unlock)(root, rest, values.reason ?? "");
      for (const f of r.changed) console.log(`✓ ${command === "eject" ? "ejected" : "unlocked"} ${f}`);
      if (!r.changed.length) console.log("· nothing to do");
      if (r.decision) console.log(`✓ recorded ${r.decision}`);
      return 0;
    }
    case "check": {
      const res = await check(root, { files: rest, format: values.format as Format, baseline: !values["no-baseline"] });
      if (res.report) (res.errors ? console.error : console.log)(res.report);
      return res.errors ? 1 : 0;
    }
    case "add": {
      if (!rest.length) throw new Error("usage: fcs add <component...>");
      for (const f of add(root, rest)) console.log(`✓ locked ${f}`);
      return 0;
    }
    case "import": {
      if (rest.length !== 1) throw new Error("usage: fcs import <DESIGN.md> [--decide <rule.param=value>...] [--write]");
      const res = importDesignDoc(root, path.resolve(rest[0]!), { decide: values.decide, write: values.write });
      console.log(res.report);
      return res.conflicts ? 1 : 0;
    }
    case "new": {
      if (rest[0] !== "page" || rest.length !== 2) throw new Error("usage: fcs new page <route> [--template page|list] [--title <text>]");
      for (const f of newPage(root, rest[1]!, { template: values.template as Template | undefined, title: values.title })) {
        console.log(`✓ created ${f}`);
      }
      return 0;
    }
    case "hook": {
      const input = JSON.parse(readFileSync(0, "utf8") || "{}") as HookInput;
      const hookRoot = process.env.CLAUDE_PROJECT_DIR ? path.resolve(process.env.CLAUDE_PROJECT_DIR) : findRoot(input.cwd ?? root);
      const out =
        rest[0] === "pre"
          ? hookPre(input, hookRoot)
          : rest[0] === "post"
            ? await hookPost(input, hookRoot)
            : rest[0] === "stop"
              ? await hookStop(input, hookRoot)
              : null;
      if (!out) throw new Error("usage: fcs hook pre|post|stop");
      if (out.stderr) process.stderr.write(`${out.stderr}\n`);
      if (out.context && rest[0] === "post") {
        process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: out.context } })}\n`);
      }
      return out.code;
    }
    default:
      process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    if (e instanceof ContractError) console.error(e.message);
    else console.error(`fcs: ${(e as Error).message}`);
    process.exit(1);
  },
);
