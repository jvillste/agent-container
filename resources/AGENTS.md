# Coding workflow

- If possible, run tests before concluding that the requested code change is
  completed. Try at least that the code compiles withot errors.
- If you suspect that I made a mistake in my request, ask if I
  actually meant something else.
- You are running in a Docker container sandbox reserved for this
  project so you can install all the software you need. The Docker
  host that I'm using is macos.
- You most likely have an Internet access. I sometimes restrict it
  though.

# Code style

- Use descriptive english words, no abbreviations or single letter
  names. For example "string" instead of "str" for the clojure.string
  alias.

# Formatting clojure code

- If the clojure compiler reports "Unmatched delimiter",
  "unexpected delimiter" or "EOF while reading", run
  `clj-paren-repair <file-name>` via bash instead of counting parens
  manually.

# About Clojure tests

- Use clojure.test for tests.
- Require clojure.test like this in the ns form: [clojure.test :refer [deftest is testing]]
- Split code to pure functions and to imperative functions and add
  tests for pure functions right below the function implementation, if
  the function is worth testing.
- Use separate namespaces for tests only when the test requires
  imports other than clojure.test that are not available in the
  namespace that is being tested.
- The name for a test that tests a single function should be formatted
  by prefixing the function name with "test-". For example
  "my-function" should be formatted like "test-my-function".
- In lein based projects, run only the relevant test with "lein test
  :only some-namespace/some-test"

# Clojure style guide

- Add docstrings only to public functions if the function name and
  parameter names are not clear enough.
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
