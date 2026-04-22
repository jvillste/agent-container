# Principles

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. And ask by
  providing choises from which to pick.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

# Coding workflow

- Always run tests before concluding that the requested code change is
  completed.
- If you suspect that the user made a mistake in their request, ask if
  they acutally meant something else.

# Code style

- Use descriptive english words, no abbreviations or single letter
  names. For example "string" insteado of "str" for the clojure.string
  alias.

# Writing clojure code
- If you run into paren related syntax errors, run "clj-paren-repair
  <file-name>" with bash to fix the parens in the file.
- Split code to pure functions and to imperative functions and add
  tests for pure functinos right below the function implementation, if
  the function is worth testing.
- Use separate namespaces for tests only when the test requires
  imports that are not available in the namespace that is being
  tested.
- Use foo-to-bar instead of foo->bar when naming functions.
- If possible, give the last word in the namespace path as alias for
  required namespaces. If the last word is "core" use the one before
  that. Example: (ns example (:require [foo.bar :as bar] [foo.core :as
  foo]))
- remember that functions that call other functions must come after
  the called functions in the namespace
