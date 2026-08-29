# Coding workflow

- Always run tests before concluding that the requested code change is
  completed.
- If you suspect that the user made a mistake in their request, ask if
  they actually meant something else.

# Code style

- Use descriptive english words, no abbreviations or single letter
  names. For example "string" instead of "str" for the clojure.string
  alias.

# Formatting clojure code

Applies to Clojure, ClojureScript and CLJC files (.clj, .cljs, .cljc).
- Step 1, while writing: separate adjacent closing parentheses with a
  single space, e.g. write `(println greeting) ) ) )` instead of
  `(println greeting))))`. Long unbroken runs of closing parens are
  where the tokenizer tends to drop or invent one, and the padding
  removes that failure mode. Pad closing parens only, never opening
  ones, and only in code you author - leave code you did not write
  alone rather than reformatting it to this convention.
- Step 2, before calling the change done: run `cljfmt fix <file-name>`
  via bash. It strips the padding again, so the file that ends up on
  disk is idiomatic and clumped `)))`. The padding is a drafting aid,
  never the committed style; do not hand-strip it yourself.
- Recovery: if the compiler still reports "Unmatched delimiter",
  "unexpected delimiter" or "EOF while reading", run
  `clj-paren-repair <file-name>` via bash instead of counting parens
  by hand. It expects idiomatically indented input, so run it after
  `cljfmt fix`, then re-run the tests.
- Both commands are on PATH (`cljfmt`, `clj-paren-repair`).


# Clojure style guide

- Split code to pure functions and to imperative functions and add
  tests for pure functions right below the function implementation, if
  the function is worth testing.
- Use separate namespaces for tests only when the test requires
  imports that are not available in the namespace that is being
  tested.
- The name for a test that tests a single function should be formatted
  by prefixing the function name with "test-". For example
  "my-function" should be formatted like "test-my-function".
- Use foo-to-bar instead of foo->bar when naming functions.
- If possible, give the last word in the namespace path as alias for
  required namespaces. If the last word is "core" use the one before
  that. Example: (ns example (:require [foo.bar :as bar] [foo.core :as
  foo]))
- remember that functions that call other functions must come after
  the called functions in the namespace
- Use let to introduce local bindings only when the binding is used
  more than once in the body. Do not give names to values only to
  document their meaning.
- in lein based projects, run only the relevant test with "lein test
  :only some-namespace/some-test"
