# Refactor Maintainability Output Templates

Read when you need a structured deliverable for maintainability work.

## Maintainability Scan

```markdown
## Maintainability Scan

- Goal: <one-sentence user goal>
- Non-goals: <behavior/API/schema/security/performance boundaries>
- Inputs inspected: <files/diff/tests/history>

### Candidates

1. <title>
   - Evidence: <file:line or concrete observation>
   - Smell signal: <type>
   - Change-cost impact: <why future changes are harder>
   - Behavior risk: low | medium | high, because <reason>
   - Classification: <category from Section 5>
   - Recommended action: fix now | separate change | defer | reject | ask/verify first
   - Smallest safe next step: <step>

### Not Recommended

- <candidate>: <why rejected or deferred>
```

## Refactor Plan

```markdown
## Refactor Plan

- Purpose: <one sentence>
- Non-goals: <what must not change>
- Behavior-preserving invariant: <summary or link>
- Characterization tests needed: yes | no, because <reason>

### Steps

1. <small step>
   - Files: <target files>
   - Change type: mechanical | structural | test-only | deletion
   - Verification: <check>
   - Rollback: <how to revert>

### Deferred Follow-ups

- <follow-up or none>
```

## Implementation Guard

```markdown
## Maintainability Implementation Guard

- Current task: <task>
- Refactor mixed with feature work: yes | no
- If yes, justification and isolation: <reason>
- Invariants checked before edit: <list>
- Regression risks avoided: <list>
- Verification after edit: <tests/checks/manual oracle>
```

## Review Finding

```markdown
### <high | medium | low>: <title>

- Evidence: <file:line or diff hunk>
- Maintainability impact: <specific future change cost>
- Behavior risk: none | possible | likely
- Suggested direction: <concrete behavior-preserving change>
- Timing: fix now | separate change | defer
```

## Characterization Test Request

```markdown
## Characterization Test Request

- Refactor target: <code path>
- Current behavior to capture: <inputs, outputs, side effects, errors, ordering>
- Why existing tests are insufficient: <reason>
- Minimal test/oracle: <test, snapshot, API comparison, manual reproduction>
- After tests exist, safe next step: <step>
```
