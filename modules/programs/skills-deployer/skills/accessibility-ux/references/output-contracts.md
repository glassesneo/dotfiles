# Accessibility / UX Output Contracts

Read when turning accessibility work into a spec, implementation note, or
review result.

## Spec or plan

```markdown
## Accessibility / UX Contract

- User tasks and affected users:
- Required keyboard behavior:
- Focus behavior:
- Semantics and names:
- Forms/errors/status messages:
- Responsive/zoom/reflow behavior:
- UX recovery/control requirements:
- Verification:
- Open questions or defaults:
```

## Implementation note

```markdown
## Accessibility / UX Implementation Notes

- Semantic choices:
- ARIA used or avoided, with reason:
- Keyboard and focus behavior:
- Error/status behavior:
- Responsive/visual behavior:
- Verification run:
- Remaining risk:
```

## Review finding

```markdown
- Severity: high | medium | low
- Evidence: <file:line, UI state, or reproduction step>
- Affected user/task impact: <who is blocked, misled, slowed, or burdened>
- Basis: <WCAG 2.2 AA / ARIA / semantic HTML / UX heuristic>
- Recommendation: <smallest safe fix>
- Verification: <automated and/or manual check>
```

Use high severity when users cannot complete a core task, keyboard users are
trapped, critical controls lack names, form errors cannot be understood or
corrected, or focus/order changes make the flow unusable.

Use medium when some users are likely to fail a task, get assistive-technology
confusion, or hit recurring friction.

Use low for local friction with limited task impact.
