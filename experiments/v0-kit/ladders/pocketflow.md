# Ladder: The-Pocket/PocketFlow

- Repo: The-Pocket/PocketFlow
- Link: https://github.com/The-Pocket/PocketFlow
- Commit: f74d023f93607b8c3268133339a5e532a949898c
- Read on: 2026-11-01 (GitHub API plus raw files at that commit; default branch `main`)
- Class: trending (about 11.3k stars, Python, the core is one file of about 100 lines)
- Confidence: high. The README, docs site, a cookbook folder and a tests folder exist. No open issue carries the `good first issue` label, so L2 and L4 pick their own target. About 77 open issues.
- Cards below are original text. The repo is linked, not copied. Do not paste the source file into cards.

## L0 Prerequisites

**Goal:** Know the ideas behind a small LLM framework: graphs, shared state, retries, batching and async.

**Pass test (proof):** In Anki, the search `tag:pocketflow tag:L0 is:new` returns 0 cards, and `tag:pocketflow tag:L0 rated:1:1` returns 0 cards on the day you declare the pass. Save a screenshot of both searches.

| Front | Back |
|---|---|
| What is a directed graph, and why does it fit a multi-step workflow? | Nodes are steps and arrows say which step may come next. The next step can depend on the outcome, so branching and loops are just extra arrows. |
| What is the difference between a fixed workflow and an agent? | A workflow follows steps decided in advance by the programmer. An agent lets the model choose the next step at run time. A graph can express both. |
| What is a shared store (blackboard) and what risk does it carry? | One dictionary that every step reads and writes. It is simple, but steps depend on key names they cannot see, so a typo or a missing key fails late. |
| What does retry with a fallback mean for a flaky call such as a model request? | Try the call up to a set number of times, optionally waiting between tries. If the last try fails, run a fallback instead of crashing the whole run. |
| In Python, what does overloading the right-shift operator on a class allow? | Code like a then b can read as a >> b. The class defines what that operator does, so a flow can be written as a chain of steps. |

## L1 Run it

**Goal:** Install the package or vendor the file, run one cookbook example, and explain what it does.

**Pass test (proof):** A pasted log or screenshot of one example running, and a 3-sentence explanation of what the nodes did, saved in your notes file `pocketflow/L1.md`.

| Front | Back |
|---|---|
| How can you get the framework into a project? | Install the package named pocketflow from PyPI, or copy the one source file into your project because it has no dependencies. |
| What are the three phases of a node, and in what order do they run? | Prep reads from the shared store, exec does the work using only what prep returned, and post writes results back and returns the name of the next action. |
| Where do you find ready-made examples to run? | In the cookbook folder at the repo root. Each example is a small app that you can run on its own. |
| Why does an example usually need an API key or a local model? | Most cookbook steps call a language model. Without a key or a local model the call step fails, so set that up before you judge the framework. |
| What does the docs site add that the README does not? | Design-pattern pages (agent, workflow, RAG, multi-agent) and the node and flow reference. Use it when a cookbook example is unclear. |

## L2 Modify

**Goal:** Add one small thing: a new test for a behavior that is not covered yet, or a small new cookbook-style example in your fork.

**Pass test (proof):** A link to your branch or diff, plus 3 questions you write about your own diff and answer without looking (v0 stand-in for generated diff questions). Save them in `pocketflow/L2.md`.

| Front | Back |
|---|---|
| Where are the tests, and what do the file names tell you about the features? | In the tests folder at the repo root. Names such as batch node, async flow and fall back show the areas covered: batching, async, flow composition and retries. |
| What does a flow do when a node returns an action name that has no successor? | It stops and warns that the action was not found. Returning nothing selects the default action. |
| Name one behavior you could pin down with a new test. | Example: adding a second successor for the same action replaces the first and warns. Or: a node with one retry calls its fallback right after the first failure. Pick one and prove it. |
| How do you run the test suite locally? | Check the repo's docs and the tests folder for the runner, then run it from the repo root and keep the log. If no runner is documented, the standard library test runner can discover the files. |
| What makes a small diff here easy to review? | One behavior, one test, no change to the core file unless the test proves a bug. The core is only about 100 lines, so every extra line is noticed. |

## L3 Understand

**Goal:** Explain how the core works: nodes, successors, the flow loop, retries, batches and async variants.

**Pass test (proof):** In Anki, `tag:pocketflow tag:L3 is:new` returns 0 cards and `tag:pocketflow tag:L3 rated:1:1` returns 0 cards. Also save a written explanation (about 150 words, from memory) in `pocketflow/L3.md`. An AI may comment on it, but the comment is not a gate.

| Front | Back |
|---|---|
| How does a node know what comes after it? | Each node holds a dictionary from action name to the next node. The operator chain fills it, using the default action unless you name another. |
| How does a flow decide which node runs next? | It runs the current node, takes the action name that node returned, and looks that name up in the node's successors. No match ends the run. |
| Why does the flow copy each node before running it? | Nodes keep per-run data such as parameters and the retry counter. Copying keeps a second pass through the same node from reusing stale values. |
| Why can a flow itself be used as a node inside another flow? | A flow is built on the same base class as a node, so it has the same run interface. That is how flows nest. |
| How does retry work in a normal node? | Exec runs inside a loop up to the maximum tries, with an optional wait between tries. On the last failure the fallback method runs, and by default it raises the error again. |
| What is the difference between a batch node and a batch flow? | A batch node maps its exec step over a list of items. A batch flow runs the whole flow once per parameter set returned by its prep step. |
| How do the parallel async variants run their work? | They start all the items together and wait for all to finish using the async gather call, instead of awaiting items one by one. |

## L4 Rebuild or contribute

**Goal:** Write your own minimal node-and-flow runner from scratch, with tests, or get a pull request merged upstream.

**Pass test (proof):** A link to your repo (or branch) with the runner and its test log, whose tests cover: branching by action, retry plus fallback, and a nested flow. Or a link to a merged pull request.

| Front | Back |
|---|---|
| What is the smallest set of behaviors your rebuild needs? | A node with prep, exec and post; a way to link nodes by action name; a flow loop that follows the returned action; and retries with a fallback. |
| Which design choice of the original would you keep, and which would you change? | Write your own answer. A common pair: keep the shared dictionary for simplicity; change silent stops on unknown actions into an explicit error. |
| How do you test branching without calling a real model? | Use fake nodes that return fixed action names. Assert the order in which they ran and which one the flow stopped on. |
| Why is the file so short, and what did the author leave out on purpose? | The core keeps only the graph idea. Vendor wrappers, tools and memory are left to the user, which is why the README stresses zero dependencies. |
| What would a good pull request to this repo contain? | A cookbook example or a fix with a test, a short description of the use case, and no growth of the core file unless a bug demands it. |
