# tj/commander.js

- Pinned SHA: `a5a7dc084d4d2b7932e85ca049c5204e50a2c721`
- Tier: trending · Language: JavaScript · Expected confidence: high
- Labelled by: qa-expert (agent) on 2026-11-12. A human spot check is still open (`checkedBy` stays `qa-expert` until the owner updates it).

## Core files (why a reader must open each)

- `lib/command.js` — Command class: command(), action(), parse(), parseOptions(), _dispatchSubcommand(), hooks, help output.
- `lib/option.js` — Option class: flags parsing, default, choices, env, conflicts, argParser.
- `lib/argument.js` — Argument class for positional arguments (required or optional, variadic).
- `lib/help.js` — Help class that builds the help text (visibleOptions, subcommandTerm, formatting).
- `lib/error.js` — CommanderError and InvalidArgumentError types.
- `lib/suggestSimilar.js` — Edit-distance code behind the 'did you mean' suggestions.
- `index.js` — Public entry point: exports program, Command, Option, Argument, Help and the error classes.

## Concepts

- command line parsing
- subcommands
- option and argument declaration
- help generation
- did you mean suggestions
- action handlers

Provenance: the README, the file listing and the declarations (class, function and type names) of the files named above were read at this SHA. The files were not read line by line.
