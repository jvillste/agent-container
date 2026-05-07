---
name: clj-paren-repair
description: "Fix delimiter errors and format Clojure code — Handles mismatched parentheses, brackets, and braces plus general formatting."
user-invocable: true
---

# clj-paren-repair: Fix Delimiter Errors and Format Clojure Code

A babashka CLI tool available on PATH.

## When to Use

- **When the compiler reports "unexpected delimiter" or "EOF while reading"** — run it on the affected files to fix structural errors

## Usage

```bash
# Fix one or more files in place
clj-paren-repair src/foo/bar.clj

# Fix all Clojure files in a directory
clj-paren-repair **/*.clj **/*.cljs **/*.cljc
```

## How It Works

- **Fixes delimiter errors** — mismatched `()` `[]` `{}` across the file
- **Formats code** — normalizes indentation and spacing
- **Idempotent** — running it twice produces the same output; if no changes are needed, the input passes through unchanged
- **Per-file** — processes one file at a time; no batch mode
- **~5ms startup** — babashka, not JVM
