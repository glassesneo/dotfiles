---
name: ai-first-doccomments
description: Write documentation comments optimized for both AI agents and human developers. Use when creating or improving DocComments, JSDoc, TSDoc, Javadoc, docstrings, or any code documentation. Triggers on requests to document code, improve searchability, add specs to source files, or make codebases more AI-navigable.
---

# AI-First DocComments

Write documentation that serves as high-quality metadata for AI code search while remaining useful to human developers.

## Core Principle: Colocation

Embed specifications directly in source code rather than maintaining separate documentation files. AI agents struggle to cross-reference external specs; colocated documentation ensures context is always immediately available.

## Three Required Elements

Every DocComment should include these elements when applicable:

### 1. Ubiquitous Language (Domain Terms)

Use exact terminology from business stakeholders, designers, and product specs.

```typescript
// ✗ Poor: Technical-only naming
/** Handles org data display */

// ✓ Good: Business terminology included
/** UI-05 Company Detail Screen - Displays company information */
```

### 2. UI/Feature Identifiers

Include IDs linking to design files, issue trackers, or feature specs.

```python
# ✗ Poor: No traceability
def process_order():
    """Process the order."""

# ✓ Good: Traceable reference
def process_order():
    """
    FEAT-1234 Order Processing
    Figma: https://figma.com/file/xxx
    """
```

### 3. Non-Obvious Logic

Document constraints, edge cases, and business rules not inferable from code.

```typescript
// ✗ Poor: States the obvious
/** Returns user data */

// ✓ Good: Documents constraints
/**
 * Returns user profile data.
 * Requires 'admin' or 'viewer' role.
 * Returns null for soft-deleted users (deleted_at != null).
 * Rate limited: 100 requests/minute per API key.
 */
```

## Complete Example

```typescript
/**
 * UI-05 Company Detail Screen
 * JIRA: PROJ-1234
 *
 * Displays detailed company information including contacts and history.
 *
 * Access: Requires authenticated user with 'admin' or 'viewer' role.
 * Routing: Invalid company_id redirects to 404 page.
 * Cache: Company data cached for 5 minutes; invalidated on update.
 */
export class CompanyDetailScreen extends Component {
  // ...
}
```

## Why This Works

1. **Searchability**: AI agents using grep/ripgrep locate code via natural language or IDs without hallucinating paths
2. **LLM Alignment**: Models are trained on OSS where docs precede implementations; `DocComment → Code` is the optimal pattern
3. **Semantic Search**: Tools like kiri MCP extract symbol + documentation as a single unit, providing both "what" and "why"
4. **Token Efficiency**: Colocated specs eliminate round-trips to external files, reducing context window usage

## Language-Specific Formats

| Language   | Format   | Example                          |
| ---------- | -------- | -------------------------------- |
| TypeScript | TSDoc    | `/** @remarks UI-05 */`          |
| Python     | Docstring| `"""FEAT-123 Description"""`    |
| Rust       | Doc      | `/// # UI-05 Company Screen`     |
| Go         | Comment  | `// CompanyScreen handles UI-05` |
| Java       | Javadoc  | `/** @see JIRA-456 */`           |

## Quick Checklist

Before committing, verify each public symbol's DocComment includes:

- [ ] Feature/UI identifier (if applicable)
- [ ] Domain terminology matching specs/designs
- [ ] Access requirements or preconditions
- [ ] Edge cases and error behaviors
- [ ] Links to external resources (Figma, JIRA, etc.)

## Anti-Patterns to Avoid

- **Restating code**: `/** Adds two numbers */ function add(a, b)`
- **Missing constraints**: Omitting auth requirements, rate limits, or validation rules
- **Technical-only language**: Using only programmer terms when business terms exist
- **Orphaned specs**: Keeping specifications in separate markdown files AI won't find
