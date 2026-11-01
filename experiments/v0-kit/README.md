# v0 experiment kit (T002)

Three hand-made ladders, one Anki import file each, and a 14-day log. No app, no server. Anki is the app.

| Ladder | Repo | Class | Confidence | Import file |
|---|---|---|---|---|
| `ladders/pocketflow.md` | The-Pocket/PocketFlow | trending | high | `anki/pocketflow.txt` |
| `ladders/mitt.md` | developit/mitt | medium | high | `anki/mitt.txt` |
| `ladders/dset.md` | lukeed/dset | lowkey | low (concept fallback in L0 to L1) | `anki/dset.txt` |

Every ladder pins the repo to the commit SHA that was read on 2026-11-01. Cards are original text. The repo is linked, not copied.

## Which ladder to climb

Climb **mitt**. Its core is one file of about 120 lines, so the L4 rebuild is realistic in 14 days. The other two stay as the test of "ladder quality" (are they usable with light edits?) and "lowkey repo" (does the concept fallback give a usable path?). Skim them on day 1 and note your verdict in `LOG.md`.

## Set up Anki (once, about 10 minutes)

1. Install Anki 23.10 or newer (FSRS is built in).
2. File, Import. Choose `anki/mitt.txt`. Anki reads the header lines (tab separator, tags in column 3). Pick note type **Basic**, field 1 is Front and field 2 is Back, and use a deck named `Idea Ladder::mitt`. Click Import.
3. Repeat for `anki/pocketflow.txt` and `anki/dset.txt` if you want the other decks.
4. Turn FSRS on: in the deck list click the gear next to the deck, Options, scroll to the FSRS section, switch **FSRS** on, and Save.
5. In the same Options screen set **New cards/day** to 6 or fewer. A ladder has about 26 cards, and 5 to 15 minutes a day is the budget.

Every card has three tags: `idea-ladder`, the ladder name and the level (`L0` to `L4`). In the browser, `tag:mitt tag:L0` shows one level.

## Daily routine (5 to 15 minutes)

1. Open the `Idea Ladder::mitt` deck and review what is due. Stop at 15 minutes.
2. Open `LOG.md` and fill today's row. Be honest about skipped days and about what felt useless.
3. Work on the current level's task in the ladder file (run it, modify it, write the explanation). A level counts only when its **Pass test (proof)** is met.

## Unlocking levels

Climb in order: do not start a level's task before the level before it has passed. Each ladder file gives the pass test. For L0 and L3 it is an Anki search that must return nothing, for example `tag:mitt tag:L0 is:new` (every card seen) and `tag:mitt tag:L0 rated:1:1` (no "Again" today). For L1, L2 and L4 it is an artifact: a log, a branch or diff link, a repo or pull-request link. An AI never grades a pass.

## Rebuilding the Anki files

```
node experiments/v0-kit/build-anki.mjs
```

The script reads `ladders/*.md` and writes `anki/<ladder>.txt`. It fails (exit code 1, message names the file and card) when a field has a tab or newline, a Back is over 300 characters or has a fenced code block, a level has fewer than 3 cards, or a level section, Goal or Pass test is missing. Optional: `--readmes DIR` with `DIR/<ladder>.md` holding the repo README also fails a card whose Back repeats a README line verbatim.

If you edit a card after import, change the `.md` file and re-import. Anki may treat a changed Front as a new note, so delete the old note first.

Tests: `node --test experiments/v0-kit/test/`.

## Not built (cut list)

`.apkg` output (the plain-text import needs no dependency), and any README-overlap check beyond an exact-line or contained-line match.
