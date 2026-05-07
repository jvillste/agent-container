---
name: balance-clojure-parens
description: "Fix 'Unmatched delimiter' coljure compiler errors. Use this always instead of trying to balance parenthesis manually."
user-invocable: true
---

# How to do it?

Use the clj-paren-repair CLI command available on PATH.

# When to Use

- **When the compiler reports "unexpected delimiter" or "EOF while reading"** — run it on the affected files to fix structural errors

# Usage

```bash
# Fix one or more files in place
clj-paren-repair src/foo/bar.clj

# Fix all Clojure files in a directory
clj-paren-repair **/*.clj **/*.cljs **/*.cljc
```

# How It Works

- **Fixes delimiter errors** — mismatched `()` `[]` `{}` across the file
  - the code must be indented idiomatically before running clj-paren-repair
- **Formats code** — normalizes indentation and spacing
