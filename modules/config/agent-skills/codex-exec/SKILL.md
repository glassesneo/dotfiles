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

**Key Flags**: `-C <dir>` (working directory), `-i <file>` (attach image), `--search` (web search), `-m <model>`

## When to Use codex-exec

Use **codex-exec** for tasks that need a single, focused response:

- **Explain code**: Understand what a function or module does
- **Find edge cases**: Identify boundary conditions in existing code
- **Quick reviews**: Post-implementation validation with `codex review`
- **Documentation lookup**: Find API references or best practices
- **Image debugging**: Fix bugs shown in screenshots
- **Web search**: Research implementation approaches

**Don't use codex-exec** for complex, iterative work—use the **codex-subagent** skill instead.

## Profiles

**`planning`** - Read-only analysis (sandbox: read-only, approval: on-request)
- Use for exploration, analysis, and research
- Safe for understanding code without side effects

**`full-auto`** - Autonomous execution (DEFAULT) (sandbox: workspace-write, approval: never, network: enabled)
- Use when you want Codex to make changes automatically
- Good for reviews that might suggest fixes

Use `-p planning` for read-only queries, `-p full-auto` (or omit) when changes are acceptable.

## Common Use Cases

### Code Explanation
```bash
codex exec -p planning -C /project "Explain the authentication middleware flow"
codex exec -p planning -C /project "What does the caching layer do?"
```

### Edge Case Identification
```bash
codex exec -p planning -C /project "Analyze payment processor for edge cases"
codex exec -p planning -C /project "Find boundary conditions in validation logic"
```

### Code Review (MANDATORY after features/refactoring)
```bash
codex review --uncommitted              # Review current changes
codex review --base main                # Review all changes vs main
```

### Documentation Lookup via DeepWiki
```bash
codex exec -p planning -C /project "Look up Axum middleware patterns using DeepWiki"
codex exec -p planning -C /project "Find React Query best practices via DeepWiki"
```

### Image-Based Debugging
```bash
codex exec -p full-auto -C /project -i bug.png "Fix the layout issue shown"
codex exec -p planning -C /project -i mockup.png "Describe implementation approach"
```

### Web Search Integration
```bash
codex exec -p planning -C /project --search "Best practices for rate limiting in Rust"
codex exec -p planning -C /project --search "How to handle WebSocket reconnection"
```

## Best Practices

1. **Research first**: Gather context yourself before delegating to Codex—shared understanding improves precision
2. **Provide context**: When requesting reviews, mention what changed and why
3. **Mandatory reviews**: MUST run `codex review --uncommitted` before committing significant changes
4. **Choose the right profile**: Use `-p planning` for read-only, omit for changes
5. **Single question focus**: Keep prompts focused on one question or task

## Examples

```bash
# Explain existing code (read-only)
codex exec -p planning -C /project "Explain how the auth token refresh works"

# Check for edge cases (read-only)
codex exec -p planning -C /project "What edge cases exist in the discount calculator?"

# Post-implementation review (may suggest changes)
codex review --uncommitted

# Documentation research (read-only)
codex exec -p planning -C /project "Look up Next.js App Router data fetching patterns"

# Quick fix from screenshot (makes changes)
codex exec -p full-auto -C /project -i error.png "Fix this runtime error"

# Research best practices (read-only + web search)
codex exec -p planning -C /project --search "Database connection pooling in Node.js"
```

## When to Switch to codex-subagent

Use the **codex-subagent** skill (interactive mode) instead when:
- Task requires multiple rounds of clarification or iteration
- Building up context through a conversation
- Complex refactoring that needs step-by-step work
- Exploratory debugging where you need back-and-forth
- Working on something that will take multiple questions

See the **codex-subagent** skill documentation for interactive workflow patterns.
