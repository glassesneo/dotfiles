---
name: codex-subagent
description: "Invoke Codex CLI for code analysis, test planning, refactoring, review, and external documentation lookup. Use for edge case identification, refactoring proposals, test coverage review, debugging via code exploration, understanding unfamiliar codebases, batch transformations, mandatory post-implementation review, image-based debugging, web search integration, and querying external docs via DeepWiki. Triggers: codex, review, analyze, refactor, edge cases, deepwiki, screenshot, image, search"
---

# Codex CLI Sub-Agent

## Quick Reference

```bash
codex exec -p <profile> "<prompt>"      # Non-interactive execution
codex review --uncommitted              # Review staged/unstaged changes
codex review --base main                # Review against branch
codex                                   # Interactive TUI mode
```

**Flags**: `-C <dir>` (working directory), `-i <file>` (attach image), `--search` (web search), `-m <model>`

## Profiles

**`planning`** - Read-only analysis (sandbox: read-only, approval: on-request)
**`full-auto`** - Autonomous execution (DEFAULT) (sandbox: workspace-write, approval: never, network: enabled)
**`agent-browser`** - Browser automation with Playwright (sandbox: workspace-write, approval: on-request)

Use `-p planning` for exploration, `-p full-auto` (or omit) for implementation.

## Usage Patterns

**Analysis** (`-p planning`): Explore codebase, debug issues, understand unfamiliar code

**Testing**: Identify edge cases, boundary conditions, test coverage gaps

**Code Review**: Use `codex review --uncommitted` (MANDATORY after features/refactoring)

**Refactoring** (`-p full-auto`): Propose strategy → implement → review with `codex review`

**Batch Processing**: Multi-file transformations requiring semantic understanding

**DeepWiki**: Delegate library/framework documentation lookups (API refs, best practices)

**Image Input** (`-i`): Debug visual bugs, implement UI from mockups, analyze error screenshots

**Web Search** (`--search`): Research implementation approaches, find solutions

## Best Practices

- Research yourself first—shared context improves Codex precision
- Provide context about changes when requesting review
- MUST run `codex review --uncommitted` before committing significant changes

## Examples

```bash
# Analysis (read-only)
codex exec -p planning -C /project "Analyze auth module for edge cases"

# Code review
codex review --uncommitted
codex review --base main

# Refactoring workflow
codex exec -p planning -C /project "Propose strategy to extract payment logic"
codex exec -p full-auto -C /project "Extract payment logic into PaymentService"
codex review --uncommitted

# DeepWiki lookup
codex exec -p planning -C /project "Look up Axum middleware patterns using DeepWiki"

# Image-based debugging
codex exec -p full-auto -C /project -i bug.png "Fix the layout issue shown"

# Web search
codex exec -p planning -C /project --search "Best practices for rate limiting in Rust"

# Batch processing
codex exec -p full-auto -C /project "Update all handlers to use new error pattern"
```
