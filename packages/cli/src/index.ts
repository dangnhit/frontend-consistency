#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { ContractError } from "@frontend-consistency/core";
import { add } from "./commands/add.js";
import { build } from "./commands/build.js";
import { check, type Format } from "./commands/check.js";
import { hookPost, hookPre, type HookInput } from "./commands/hook.js";
import { init } from "./commands/init.js";

const HELP = `fcs — keep AI-generated UI consistent with your design contract

Usage:
  fcs init [--claude] [--registry <url>]   scaffold .design/, registry, ESLint, agent hooks
  fcs build                                generate agent files + components/fcs/contract.generated.ts
  fcs check [files...] [--format agent]    validate contract, lock, generated files, lint
  fcs add <component...>                   install @fcs components and lock them
  fcs hook pre|post                        Claude Code hook entry (reads JSON on stdin)

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
      const r = init(root, { registry: values.registry, claude: values.claude });
      for (const d of r.done) console.log(`✓ ${d}`);
      try {
        for (const w of build(root).filter((x) => x.changed)) console.log(`✓ generated ${w.file}`);
      } catch (e) {
        if (!(e instanceof ContractError)) throw e;
        r.todo.unshift(`Contract not buildable yet (${e.issues[0]?.message}). Install the preset, then run \`fcs build\`.`);
      }
      if (r.todo.length) console.log(`\nNext:\n${r.todo.map((t) => `  • ${t}`).join("\n")}`);
      return 0;
    }
    case "build": {
      const res = build(root);
      for (const w of res) console.log(`${w.changed ? "✓ wrote" : "· unchanged"} ${w.file}`);
      return 0;
    }
    case "check": {
      const res = await check(root, { files: rest, format: values.format as Format });
      if (res.report) (res.errors ? console.error : console.log)(res.report);
      return res.errors ? 1 : 0;
    }
    case "add": {
      if (!rest.length) throw new Error("usage: fcs add <component...>");
      for (const f of add(root, rest)) console.log(`✓ locked ${f}`);
      return 0;
    }
    case "hook": {
      const input = JSON.parse(readFileSync(0, "utf8") || "{}") as HookInput;
      const hookRoot = path.resolve(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? root);
      const out = rest[0] === "pre" ? hookPre(input, hookRoot) : rest[0] === "post" ? await hookPost(input, hookRoot) : null;
      if (!out) throw new Error("usage: fcs hook pre|post");
      if (out.stderr) process.stderr.write(`${out.stderr}\n`);
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
