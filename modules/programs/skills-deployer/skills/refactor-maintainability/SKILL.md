---
name: refactor-maintainability
description: Use for behavior-preserving refactoring and maintainability work across specification planning, implementation planning, implementation, code review, and refactor tasks. Trigger on requests to find safe cleanup candidates, classify code smells, split a refactor plan, define behavior-preserving invariants, decide fix-now versus separate-change, or review maintainability/readability/design degradation. Do not use for feature changes, bug fixes that intentionally change behavior, rewrites, migrations, performance optimization, security-boundary changes, formatting-only disputes, or generated/vendor code cleanup unless the user explicitly scopes a behavior-preserving maintainability task.
---

# Refactor Maintainability Skill

## 1. Purpose

Improve maintainability without changing externally observable behavior. The goal is to lower future change cost by improving understandability, modifiability, and testability — not to make code look cleaner in the abstract.

Treat refactoring as a sequence of small behavior-preserving transformations. Treat code smells as signals requiring investigation, not proof that code is wrong.

## 2. When to Use / Not Use

**Use** when the task involves: finding safe cleanup candidates, classifying code smells, splitting a refactor plan, defining behavior-preserving invariants, deciding fix-now vs separate-change, implementing a behavior-preserving change, or reviewing for maintainability regressions.

**Do not use** when the task is primarily: a feature change, an intentional bug fix, a rewrite/migration/redesign, a performance optimization where timing, ordering, resource use, or throughput may be observable, a security-boundary change, a formatting-only dispute, generated/vendor code cleanup, dead-code deletion without reachability evidence, or broad cleanup unrelated to the current user goal.

If a request mixes feature work and refactoring, separate them unless the user explicitly accepts the mix and the behavior-changing part is isolated and testable.

## 3. Inputs to Inspect

Inspect the smallest useful set before producing findings or edits:

1. User goal, confirmed spec, plan, or issue/PR description
2. Target diff or files
3. Nearby tests, snapshots, or fixtures
4. Public interfaces: exported functions, CLI flags, routes, schemas, events, config keys, file formats
5. Callers/callees at the boundary of the change
6. Error, validation, logging, persistence, network, auth, and concurrency behavior touched by the change
7. Repository conventions for naming, layering, module ownership, and test style

If a required behavior contract is unknown and could change scope, public interfaces, or acceptance criteria, stop and ask for clarification or add characterization tests before refactoring.

## 4. Code Smell Detection Procedure

1. **Fix the purpose** in one sentence. Example: "Reduce duplicated validation branches in campaign lifecycle handling without changing API responses."
2. **State non-goals**: behavior, API, schema, auth, persistence, and performance characteristics that must not change.
3. **Scan for smells**:

   * Bloaters: long method, large class, long parameter list, primitive obsession, data clumps
   * Change preventers: shotgun surgery, divergent change, parallel structures that must change together
   * Dispensables: duplicate code, dead code, speculative generality, comments that restate code
   * Couplers: feature envy, inappropriate intimacy, message chains, hidden dependency on internals
   * Misplaced tests: brittle mocks, tests locked to private implementation, missing boundary coverage
4. **Confirm context**: Is this area changed often? Is the smell in the path of the current task? Is there evidence it increases change cost?
5. **Check behavior risk**: Identify inputs, outputs, side effects, errors, ordering, persistence, public API, auth, and concurrency.
6. **Check test support**: If current behavior is not pinned and the change is non-mechanical, require characterization tests.
7. **Convert to candidate**: "Because <evidence>, future changes to <concern> require <extra work/risk>. Candidate: <small behavior-preserving change>."
8. **Classify and recommend**: Use the classification in Section 5.

Do not use metric thresholds as automatic severity. High complexity or coupling means "inspect first," not "must refactor."

## 5. Refactor Candidate Classification

**Categories:**

* **Safe mechanical**: Rename, move, extract, inline, import cleanup, or tool-assisted transformation with clear behavior preservation.
* **Safe structural**: Responsibility split, duplication removal, dependency direction improvement with tests and stable boundaries.
* **Needs characterization**: Existing behavior is under-specified or tests are missing.
* **Behavior-risking**: Could affect errors, auth, persistence, event order, public API, concurrency, or performance-sensitive behavior.
* **Speculative**: Adds abstraction for hypothetical future needs rather than current repeated knowledge.
* **Out of scope**: Requires feature behavior, schema/API migration, security change, generated/vendor modification, or redesign.

**Action decisions:**

* **Fix now** when: it's in the current change area, it reduces immediate change risk, behavior-preserving invariants are known, verification is available in the same change, and the diff remains small and reviewable.
* **Split into a separate change** when: it's valuable but not necessary for the current goal; it affects many files or public boundaries; it would mix mechanical movement with semantic changes; or it would make review harder.
* **Defer** when: the code is smelly but stable and rarely changed; benefit is plausible but not tied to current work; tests or behavior oracles are not available.
* **Reject** when: the change is speculative generality; the abstraction would hide domain differences that currently matter; or the candidate is based only on taste or metric score.
* **Ask or verify first** when the decision depends on public compatibility, ownership, or unknown runtime behavior.

## 6. Behavior-Preserving Invariants

Before implementation, write the invariant that must remain true across every observable dimension:

* **Inputs/outputs**: same accepted inputs and returned values
* **Errors/exceptions**: same thrown errors, codes, validation failures, HTTP statuses, and failure timing
* **Side effects**: same database writes, file writes, network calls, logs, notifications, metrics, cache updates
* **Ordering**: same sort order, event order, transaction order, callback sequence when observable
* **Persistence**: same schema, migrations, stored values, defaults, serialization, file formats
* **Public API**: same names, types, parameters, return values, CLI flags, routes, config keys
* **Permissions**: same auth, authorization, tenant boundaries, access checks
* **Concurrency**: same locks, transactions, idempotency, race behavior, retries, cancellation
* **Performance**: no degradation violating documented SLA, timeout, memory, or throughput expectations
* **Tests**: existing acceptance criteria and regression tests continue to pass

If you cannot fill this in for a behavior-risking candidate, do not implement the refactor yet.

```markdown
## Behavior-Preserving Invariant

- Scope: <files/modules/functions>
- Must preserve:
  - Inputs/outputs: <contract>
  - Errors/exceptions: <contract>
  - Side effects: <contract>
  - Ordering / Persistence / Public API / Permissions / Concurrency / Performance: <contract or not applicable>
- Behavior oracle: <existing tests, characterization tests, snapshots, manual checks, API diff>
- Unknowns: <none or questions to resolve before editing>
```

## 7. Splitting Into Small Steps

1. Separate behavior-changing work from refactoring work.
2. Separate mechanical changes from structural changes.
3. Create characterization tests before changing unclear behavior.
4. Preferred order:

   1. Add/confirm tests or behavior oracle
   2. Rename or move without logic changes
   3. Extract function/module/class around one coherent responsibility
   4. Redirect one caller or path at a time
   5. Remove duplication after both old and new paths are verified
   6. Delete obsolete code only after reachability and external use are confirmed
5. After each step, state the verification that should pass.
6. Stop when the current user goal is satisfied; record further cleanup as follow-up.

```markdown
### Step <N>: <small change>

- Edit: <file(s)>
- Change type: mechanical | structural | test-only | deletion
- Behavior invariant protected: <invariant item>
- Verification: <test/check/manual comparison>
- Rollback unit: <commit/patch/file revert>
```

## 8. When Characterization Tests Are Required

Add or request characterization tests before refactoring when any of the following apply:

* Existing behavior is undocumented or surprising
* Tests do not cover the path being restructured
* The code has important side effects such as persistence, network, logging relied on by operators, notifications, or scheduled jobs
* Error behavior, ordering, authorization, concurrency, or serialization could change
* Dead-code deletion depends on uncertain reachability
* The refactor moves logic across module, process, API, package, or ownership boundaries
* The code is legacy or highly coupled

Characterization tests must capture current observed behavior, not desired future behavior. Acceptable oracles: unit/integration tests, golden/snapshot outputs, API response comparisons, CLI diffs, type checks, static analysis, or manual reproduction notes.

## 9. Review: Finding Severity Levels

* **High**: The change likely hides a behavior change, breaks a public/side-effect contract, introduces cross-boundary coupling, or makes future correct changes unsafe without major rework.
* **Medium**: The change increases complexity, duplicates domain knowledge, spreads responsibility, or weakens tests in a way likely to slow near-term changes.
* **Low**: Local readability, naming, or consistency friction with limited blast radius.
* **Nit/optional**: Style or preference comments; omit unless the user explicitly asks for exhaustive review.

Do not block a review on a smell alone. Block only when the smell creates concrete correctness, compatibility, reviewability, or verification risk for the current change.

## 10. Maintainability Regressions to Avoid

* Mixing feature changes with refactors without explicit scope and separate verification
* Creating abstractions because two pieces of code look similar, before the shared knowledge is stable
* Moving code in a way that reverses dependency direction or exposes internals
* Increasing mutable state scope, hidden global state, or implicit ordering dependencies
* Spreading the same condition, policy, or state transition across multiple files
* Replacing clear local code with clever indirection
* Adding mocks that lock tests to private implementation
* Removing comments that explain *why* a constraint exists
* Renaming public or externally referenced symbols as part of internal cleanup
* Deleting apparently unused code without checking dynamic references, external callers, configuration, scheduled jobs, migrations, reflection, or generated usage
* Broadening exception handling or changing error text/status when callers may observe it
* Introducing framework, language, or tool assumptions into a generic refactor plan

## 11. Output Templates

### Maintainability Scan

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

### Refactor Plan

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

### Implementation Guard

```markdown
## Maintainability Implementation Guard

- Current task: <task>
- Refactor mixed with feature work: yes | no
- If yes, justification and isolation: <reason>
- Invariants checked before edit: <list>
- Regression risks avoided: <list>
- Verification after edit: <tests/checks/manual oracle>
```

### Review Finding

```markdown
### <high | medium | low>: <title>

- Evidence: <file:line or diff hunk>
- Maintainability impact: <specific future change cost>
- Behavior risk: none | possible | likely
- Suggested direction: <concrete behavior-preserving change>
- Timing: fix now | separate change | defer
```

### Characterization Test Request

```markdown
## Characterization Test Request

- Refactor target: <code path>
- Current behavior to capture: <inputs, outputs, side effects, errors, ordering>
- Why existing tests are insufficient: <reason>
- Minimal test/oracle: <test, snapshot, API comparison, manual reproduction>
- After tests exist, safe next step: <step>
```

