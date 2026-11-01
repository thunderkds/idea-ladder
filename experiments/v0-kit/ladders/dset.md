# Ladder: lukeed/dset

- Repo: lukeed/dset
- Link: https://github.com/lukeed/dset
- Commit: 05b1ec0f8cebe3b5d5667285bc7da90f38a7215e
- Read on: 2026-11-01 (GitHub API plus raw files at that commit; default branch `master`, not `main`)
- Class: lowkey (about 783 stars, JavaScript, a 9-line core function plus a short merge module)
- Confidence: low. Thin repo signals: no GitHub topics, no `good first issue` label on any issue, about 13 open items (mostly bug reports and unreviewed pull requests), and a core small enough to read in one minute. The README does exist and is usable for the API.
- Fallback used: L0 and L1 are concept-only (nested paths, prototype pollution, how to call a utility). They teach the idea, not repo-specific setup. L2 to L4 are repo-specific and tied to the open issues seen on the read date (issue titles only, re-read them before you start).
- Cards below are original text. The repo is linked, not copied.

## L0 Prerequisites

**Goal:** Know the concepts the utility depends on: nested object paths, dot-path strings, prototype pollution and the typeof pitfalls of null. This level is concept-only because the repo gives little to build on.

**Pass test (proof):** In Anki, the search `tag:dset tag:L0 is:new` returns 0 cards, and `tag:dset tag:L0 rated:1:1` returns 0 cards on the day you declare the pass. Save a screenshot of both searches.

| Front | Back |
|---|---|
| What does it mean to write a value deep inside a nested object by path? | You name each step down, for example a then b then c, and the tool creates missing levels on the way and stores the value at the end. |
| Why is writing by path harder than reading by path? | Reading can stop and return nothing at a missing level. Writing must invent the missing levels and choose a type for each: plain object or array. |
| What is prototype pollution? | An attacker-controlled key such as the prototype link name makes a write land on the shared base object. Every object then inherits the attacker's value. |
| Which key names must a path writer refuse, and why? | The prototype link, the constructor and the prototype property names. Writing through them can reach the shared base objects. |
| In JavaScript, why is the typeof check on null a classic trap? | The typeof operator reports object for null. Code that tests for an object by typeof alone treats null as something it can read properties from, and then throws. |

## L1 Run it

**Goal:** Use the published package in a throwaway script and explain what it did. This level is concept-only: the repo has no setup that needs cloning.

**Pass test (proof):** A pasted log of a script of yours that sets a nested value and prints the object, and a 3-sentence explanation of what changed, saved in `dset/L1.md`.

| Front | Back |
|---|---|
| How do you get the package for a quick experiment? | Create an empty folder, run npm init, install the package named dset, and import its named export in a small script. |
| What are the three inputs of the main function? | The target object, the path as a dot string or an array of keys, and the value to store. It changes the object in place and returns nothing useful. |
| What does the function do with a missing middle level of the path? | It creates it. The next key decides the type: a number-like key creates an array and any other key creates an object. |
| Why should you print the object before and after in your log? | The function mutates in place and returns nothing. Printing both states is the only proof of what it did. |
| What is the second entry point the package offers besides the default one? | A merge mode. It joins the new value with an existing object at the end of the path instead of replacing it. |

## L2 Modify

**Goal:** Reproduce one open issue with a failing test, or add one missing test, in your own fork.

**Pass test (proof):** A link to your branch or diff that holds a test failing before your change and passing after it (or a clearly labelled test for current behavior), plus 3 questions you write about your own diff. Save them in `dset/L2.md`.

| Front | Back |
|---|---|
| Which test runner and style does the project use? | A small runner called uvu, with test suites in separate files for basics, arrays, objects, pollution and so on. Add your case to the closest suite. |
| Name two open-issue themes seen on the read date. | One is about null values met while walking a path, another about merging at the root of the object. Re-read the issue list first, because it may have moved. |
| Before you start on an issue, what two checks avoid wasted work? | Check whether an open pull request already fixes it, and check whether the maintainer has replied. Several fix pull requests were open at the read date. |
| Why write the failing test before the fix? | A test that fails first proves it reproduces the bug. Without that, a passing test after the fix proves nothing. |
| What belongs in a diff to a 9-line function? | One behavior change with its test. Any added line is a large relative change, so explain it in the pull request text. |

## L3 Understand

**Goal:** Explain how the core function works line by line and why each guard exists.

**Pass test (proof):** In Anki, `tag:dset tag:L3 is:new` returns 0 cards and `tag:dset tag:L3 rated:1:1` returns 0 cards. Also save a written explanation (about 150 words, from memory) in `dset/L3.md`. An AI may comment on it, but the comment is not a gate.

| Front | Back |
|---|---|
| How does the function turn a string path into steps? | If the keys input has a split method, it is a string and is split on dots into an array. An array input is used as it is. |
| What does the loop do on each key? | It converts the key to text, stops at a forbidden name, and otherwise moves one level down, creating or reusing the child. On the last key it stores the value. |
| What happens on a forbidden key? | The loop breaks and the function returns quietly. Levels created earlier in the same call stay, so a partial write is possible. |
| How does the code choose between a new array and a new object? | It multiplies the next key by zero. A real number gives zero and picks an array. A non-number gives not-a-number and picks an object. A dot in the key also picks an object. |
| Why does an existing null value break a deeper write? | The reuse test uses typeof, which reports object for null. The code keeps the null and then tries to step into it, which throws. |
| How does merge mode change the final step? | On the last key it combines the old value and the new one recursively when both are objects, instead of overwriting the old one. |

## L4 Rebuild or contribute

**Goal:** Write your own deep-set function with tests, or get a pull request merged upstream.

**Pass test (proof):** A link to your repo (or branch) with the function and its test log, whose tests cover: array versus object creation, forbidden keys, an existing null in the path, and root-level behavior. Or a link to a merged pull request.

| Front | Back |
|---|---|
| What behaviors must your rebuild have? | Accept a string or array path, create missing levels with the right type, store the value, and refuse the three dangerous key names. |
| How would you treat null differently from the original? | Replace a null (or any non-object) in the path with a fresh container before stepping in, instead of reusing it. Decide, then test it. |
| Which edge cases belong in your tests? | An empty path, a path of one key, a numeric key, a key containing a dot inside an array path, a forbidden key in the middle, and an existing primitive in the path. |
| Should a forbidden key stop quietly or raise an error? | Write your own answer and defend it. Quiet stops hide attacks and partial writes. Errors are louder but may break callers who rely on the quiet behavior. |
| If upstream seems inactive, how do you still finish L4? | Use the rebuild option. A merged pull request depends on someone else, while your own repo with tests is fully in your control. |
