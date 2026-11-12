# pallets/click

- Pinned SHA: `8abb77a8432e03ed14a95f972b44f905279415a7`
- Tier: trending · Language: Python · Expected confidence: high
- Labelled by: qa-expert (agent) on 2026-11-12. A human spot check is still open (`checkedBy` stays `qa-expert` until the owner updates it).

## Core files (why a reader must open each)

- `src/click/core.py` — Context, Command, Group, Parameter, Option, Argument: the model and invoke/parse flow (4,020 lines).
- `src/click/decorators.py` — @command, @group, @option and @argument decorators that build those objects.
- `src/click/parser.py` — Option parser that turns argv into parameter values.
- `src/click/types.py` — ParamType hierarchy (Choice, IntRange, DateTime, ...) used to convert and check values.
- `src/click/exceptions.py` — ClickException family that shows usage errors and sets exit codes.
- `src/click/termui.py` — Prompts, confirm, echo styling and progress bar helpers.
- `src/click/shell_completion.py` — Shell completion for Bash, Zsh, Fish and PowerShell.
- `src/click/formatting.py` — Help page layout helpers (HelpFormatter).

## Concepts

- decorator based commands
- command groups and nesting
- parameter types
- context object
- help page generation
- shell completion

Provenance: the README, the file listing and the declarations (class, function and type names) of the files named above were read at this SHA. The files were not read line by line.
