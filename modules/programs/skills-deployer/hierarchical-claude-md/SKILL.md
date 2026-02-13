---
name: hierarchical-claude-md
description: Guide for structuring CLAUDE.md files in a hierarchical manner across project directories. Use this skill when setting up Claude Code configuration for a project, organizing project-wide vs module-specific rules, or optimizing context token usage through strategic rule placement. Triggers include requests to create CLAUDE.md files, configure Claude Code for a repository, or establish coding standards at different directory levels.
---

# Hierarchical CLAUDE.md Strategy

This skill explains how to structure CLAUDE.md files across root and subdirectories to maximize Claude Code's effectiveness while minimizing context token usage.

## Core Concept: Scope vs Timing

Understanding two key dimensions:
- **Scope**: Where rules apply (global vs local)
- **Timing**: When rules load (always vs on-demand)

## Root Directory (`./CLAUDE.md`)

Acts as the project's **Constitution**—loaded at session start, applies everywhere.

### What to Include

```markdown
# Project: MyApp

## Commands
- Build: `npm run build`
- Test: `npm test`
- Lint: `npm run lint`

## Code Style
- Use ES modules (no `require`)
- 2-space indentation
- camelCase for variables, PascalCase for components

## Git Workflow
- Branch: `feature/ticket-description`
- Commits: `type(scope): message`

## Architecture
See @docs/architecture.md for details.
```

### Best Practices

1. **Keep it concise** (~30 lines target)
2. **Reference, don't duplicate**: Link to detailed docs with `@path/to/file.md`
3. **Focus on universals**: Only rules that apply to ALL code

## Subdirectories (`src/feature/CLAUDE.md`)

Act as **Local Ordinances**—lazy-loaded only when working in that directory.

### What to Include

```markdown
# Payment Module

## Responsibility
Handles all payment processing and billing logic.

## Constraints
- NO direct database access—use `@src/shared/db`
- All external API calls go through `@src/services/api`
- Money values use Decimal, never float

## Testing
- Mock external APIs with `nock`
- Required coverage: 90%+
```

### Best Practices

1. **Define boundaries**: What this module does and doesn't do
2. **Local constraints**: Rules specific to this area only
3. **Prevent context pollution**: Keep global CLAUDE.md clean

## Comparison Table

| Aspect | Root (`./CLAUDE.md`) | Subdirectory (`feature/CLAUDE.md`) |
|--------|---------------------|-----------------------------------|
| Analogy | Constitution | Local Ordinance |
| Loading | Always (startup) | Lazy (on-demand) |
| Content | Build, Git, Linter | Module boundaries, local APIs |
| Goal | Project consistency | Deep context when needed |

## Maintenance Tips

### Use Imperative Mood
Write clear, direct rules:
- ✓ "Always use Vitest for testing"
- ✓ "Never commit directly to main"
- ✗ "It would be good if you used Vitest"

### Quick Rule Addition
During a session, use `#` to add rules instantly:
```
# Always destructure props in React components
```

### Periodic Cleanup
Use `/memory` command to:
- Remove duplicate rules
- Resolve contradictions
- Prune outdated instructions

## Anti-Patterns to Avoid

1. **Overloaded root**: Don't put module-specific rules in root CLAUDE.md
2. **Redundant rules**: Don't repeat root rules in subdirectories
3. **Verbose explanations**: Keep rules actionable, not explanatory
4. **Missing references**: Always link to detailed docs instead of inlining

## Token Efficiency Strategy

```
./CLAUDE.md (30 lines)           ← Always loaded
├── src/
│   ├── auth/CLAUDE.md (20 lines)    ← Loaded only in auth/
│   ├── payments/CLAUDE.md (25 lines) ← Loaded only in payments/
│   └── shared/CLAUDE.md (15 lines)   ← Loaded only in shared/
└── docs/
    └── architecture.md              ← Referenced, loaded on demand
```

This structure ensures Claude only loads relevant context, saving tokens for actual work.
