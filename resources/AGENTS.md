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

- If the clojure compiler reports "Unmatched delimiter",
  "unexpected delimiter" or "EOF while reading", run
  `clj-paren-repair <file-name>` via bash instead of counting parens
  by hand.


# Clojure style guide
- Use clojure.test for tests.
- Split code to pure functions and to imperative functions and add
  tests for pure functions right below the function implementation, if
  the function is worth testing.
- Use separate namespaces for tests only when the test requires
  imports other than clojure.test that are not available in the
  namespace that is being tested.
- require clojure.test like this in the ns form: [clojure.test :refer [deftest is testing]]
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
