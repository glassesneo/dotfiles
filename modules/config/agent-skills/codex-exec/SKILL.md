---
name: codex-exec
description: "Quick one-shot Codex queries for code analysis, review, and lookups. Use for rapid code explanations, edge case checks, post-implementation reviews, documentation searches, and getting single focused answers. Ideal for tasks that don't require iterative back-and-forth. Triggers: codex exec, review, quick, one-shot, explain, lookup, analyze code"
---

# Codex Exec: One-Shot Queries

## Quick Reference

```bash
codex exec -p <profile> "<prompt>"      # Single-shot query
codex review --uncommitted              # Review staged/unstaged changes
codex review --base main                # Review against branch
```

**Key Flags**: `-C <dir>`, `-i <file>` (image), `--search` (web), `-m <model>`

## Examples

```bash
# Explain code (read-only)
codex exec -p planning -C /project "Explain the auth token refresh flow"

# Find edge cases (read-only)
codex exec -p planning -C /project "Analyze payment processor edge cases"

# MANDATORY: Review before commit
codex review --uncommitted

# Documentation lookup (read-only)
codex exec -p planning -C /project "Look up Axum middleware patterns using DeepWiki"

# Fix from screenshot (makes changes)
codex exec -p full-auto -C /project -i bug.png "Fix this layout issue"

# Web search (read-only)
codex exec -p planning -C /project --search "Rate limiting best practices in Rust"
```
