# Ladder: developit/mitt

- Repo: developit/mitt
- Link: https://github.com/developit/mitt
- Commit: 6b41670516ed8e8b738612f60491995470aa63b3
- Read on: 2026-11-01 (GitHub API plus raw files at that commit; default branch `main`)
- Class: medium (about 11.9k stars, TypeScript, one source file of about 120 lines, last push 2024-08)
- Confidence: high. The README is complete, the core is one file, a test folder exists. No open issue carries the `good first issue` label, so L2 and L4 pick their own target.
- Why it is the recommended ladder to climb: the core is small enough to rebuild in a few days, so L4 is realistic inside 14 days.
- Cards below are original text. The repo is linked, not copied.

## L0 Prerequisites

**Goal:** Know the ideas that mitt rests on before you open its code: publish/subscribe, closures, Map, function identity and basic TypeScript generics.

**Pass test (proof):** In Anki, the search `tag:mitt tag:L0 is:new` returns 0 cards, and the search `tag:mitt tag:L0 rated:1:1` returns 0 cards on the day you declare the pass. Save a screenshot of both searches.

| Front | Back |
|---|---|
| What problem does a publish/subscribe emitter solve? | It lets one part of a program announce that something happened without knowing who listens. Listeners register by event name, so sender and receiver stay decoupled. |
| Why is a Map a safer handler store than a plain object when event names can be Symbols? | A Map accepts any value as a key and never collides with inherited names. A plain object turns most keys into strings and carries inherited properties such as constructor. |
| What is a closure, and how does a factory function use one to hide state? | A closure is a function that remembers variables from where it was created. A factory can create a private list, return methods that use it, and give outsiders no other way to touch it. |
| Why can you only remove a listener if you kept a reference to the same function? | Removal compares function identity. Two arrow functions with identical text are two different objects, so an inline arrow passed to add cannot be matched later. |
| In TypeScript, what does a generic type parameter such as Events buy you? | The caller describes once which event names exist and what payload each carries. The compiler then rejects a wrong event name or a wrong payload type at each call. |

## L1 Run it

**Goal:** Clone the repo, run its test script, and explain in your own words what the library does.

**Pass test (proof):** A pasted terminal log of the project's test command (or the exact install error plus the Node version, if it fails) and a 3-sentence explanation of what mitt does, saved in your notes file `mitt/L1.md`.

| Front | Back |
|---|---|
| Which file holds the whole library, and about how long is it? | The single source file under src, named index.ts. It is roughly one hundred twenty lines, and most of that is type declarations and comments. |
| What are the three methods on the object that mitt returns? | on to register a handler, off to remove one, and emit to fire an event. The returned object also exposes the handler Map as a property called all. |
| What does the project's npm test script run, in order, at this commit? | A type check, then lint, then the mocha tests, then a separate compile check of the type tests. If any step fails, the script stops. |
| What does a wildcard handler receive that a normal handler does not? | A normal handler gets only the payload. A handler registered under the star name gets the event name first and then the payload. |
| Why might the install step fail on a very new Node version? | The dev dependencies are old (a 2020-era bundler and a version 8 test runner). Old tooling can break on new runtimes, so log the error and the Node version. |

## L2 Modify

**Goal:** Change or add one small thing: a new test for behavior that is not covered yet, or a tiny helper in your own fork.

**Pass test (proof):** A link to your branch or diff, plus 3 questions you write about your own diff and answer without looking (v0 stand-in for generated diff questions). Save them in `mitt/L2.md`.

| Front | Back |
|---|---|
| Where do the tests live, and what style do they use? | In the test folder, as a mocha file written with chai assertions and sinon spies. Each test registers handlers, calls emit, and checks which spies were called. |
| How do you check that a handler was or was not called in these tests? | You create a spy, register it, fire the event, and assert on call count. A spy records every call, so you can also check the arguments. |
| Name one behavior of mitt that you could pin down with a new test. | Examples: calling off for a handler that was never added changes nothing; emit with no listeners does not throw; a handler added twice is called twice. Pick one and prove it. |
| What belongs in a good small diff for this repo? | One behavior, one test, no new dependency. The library is valued for being tiny, so avoid features that grow the source. |
| Before you open a pull request upstream, what should you check first? | Read the open issues and the contribution habits of the repo. Check whether the change fits a tiny library, and whether someone already proposed it. |

## L3 Understand

**Goal:** Explain how the core works: how handlers are stored, in what order emit calls them, and what off does in each case.

**Pass test (proof):** In Anki, `tag:mitt tag:L3 is:new` returns 0 cards and `tag:mitt tag:L3 rated:1:1` returns 0 cards. Also save a written explanation (about 150 words, from memory) in `mitt/L3.md`. An AI may comment on it, but the comment is not a gate.

| Front | Back |
|---|---|
| How does mitt store handlers? | In a Map from event name to an array of handler functions. The Map is created inside the factory unless the caller passes one in. |
| In what order does emit call handlers? | First every handler registered for that exact event name, in registration order. Then every wildcard handler, also in registration order. |
| Why does emit copy the handler array before looping? | A handler may remove itself or another handler while the loop runs. Looping over a copy keeps the current emit stable, so no neighbour gets skipped. |
| What does off do when you give no handler? | It replaces the array for that event with an empty one, so every handler of that name is gone. |
| What does off do when you give a handler that was never added? | Nothing is removed. The index lookup returns minus one, an unsigned shift turns that into a huge number, and splicing at that position deletes nothing. |
| What happens if one handler throws during emit? | The error propagates out of emit and the remaining handlers for that call do not run, because the loop has no try block. |

## L4 Rebuild or contribute

**Goal:** Write your own minimal event emitter in TypeScript from scratch, with tests, or get a pull request merged upstream.

**Pass test (proof):** A link to your repo (or branch) with the emitter and its test log, whose tests cover wildcard order, off with and without a handler, and copy-before-loop. Or a link to a merged pull request.

| Front | Back |
|---|---|
| What is the smallest set of behaviors your rebuild must have to count as an emitter? | Register a handler by name, remove one, fire an event with a payload, and call wildcard handlers after named ones. Everything else is optional. |
| Which design decision in mitt would you copy, and which would you change? | Write your own answer. A common pair: copy the exposed Map for easy clearing; change error handling so one bad handler does not stop the others. |
| How do you test the copy-before-loop rule? | Register a handler that removes a second handler, emit once, and assert the second handler still ran in that emit but not in the next one. |
| Why rebuild before reading the answer again? | Retrieval beats re-reading. Forcing yourself to recall the design shows which decisions you truly understood and which you only recognized. |
| What would make a pull request to a tiny library likely to be accepted? | It fixes a clear bug or documents a real gap, adds a test, keeps the size small, and links the issue it solves. |
