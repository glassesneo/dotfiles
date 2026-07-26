# Agent Artifact Examples

These examples show the common hierarchy and minimum useful shape of non-report
artifacts. They do not replace a workflow-specific output contract.

## Artifact Priority

When a report compares implementation work against planning artifacts, use:

```text
design > implementation report
```

- `design`: the implementation contract and judgment criteria.
- `implementation report`: post-work record and deviation log.
- `decision-record`: rationale and history. It never overrides the design.

## Common Locations

- Designs: `.agents/designs/YYYYMMDD-HHMMSS-<kebab-slug>.md`
- Decision records: `.agents/decision-records/YYYYMMDD-HHMMSS-<kebab-slug>.md`
- Research: `.agents/research/YYYYMMDD-HHMMSS-<kebab-slug>.md`
- Implementation reports:
  `.agents/implementation-reports/YYYYMMDD-HHMMSS-<kebab-slug>.md`
- Review reports: `.agents/review-reports/YYYYMMDD-HHMMSS-<kebab-slug>.md`
- Bug reports: `.agents/bug-reports/YYYYMMDD-HHMMSS-<kebab-slug>.md`
- Failure reports: `.agents/failure-reports/YYYYMMDD-HHMMSS-<kebab-slug>.md`

## Design and Decision-Record Split

A design and its decision record are written from the same dialogue but serve
different readers. Route each piece of content with this test:

- An agent with zero context must implement faithfully from the design alone.
  Anything required for that belongs in the **design**.
- Content that only explains how the result was reached belongs in the
  **decision record**: direction changes, rejected viable alternatives, a
  recommendation the user overruled, and constraints discovered late that moved
  scope.
- Content that is neither belongs nowhere. Do not record a settled minor detail
  as a decision; write it as ordinary design text or leave it out.

Write at most one decision record per design, and only when the dialogue
actually produced recordable history.

## Design Format

```markdown
# Design: <title>

Status: implementation-ready | blocked
Decision record: <path or none>

## Summary

<what will exist after the work, in a few sentences>

## Problem and Goal

<the user goal this serves and the problem it solves>

## Scope

- In scope: <work included>
- Out of scope: <work explicitly excluded>

## Constraints and Repository Facts

- <verified fact, ownership boundary, or external contract, with evidence>

## Approach

<the durable implementation direction and why it fits the constraints above>

## Acceptance Criteria

- `AC1`: <observable, verifiable statement>
- `AC2`: <observable, verifiable statement>

## Scale Contract

- Expected footprint: <rough file count and affected areas>
- New interfaces, abstractions, or dependencies: <list, or `none`>
- Do not build: <over-engineering excluded at this scale, or `nothing specific`>

## Verification

- `AC1`: <command, inspection, or runtime observation> — <evidence of success>

## Risks and Open Items

- <risk, mitigation, deferral, or `none`>
```

Rules:

- Assign stable sequential AC IDs. Treat them as append-only across revisions:
  never renumber and never reuse a gap. Mark a withdrawn criterion `withdrawn`
  in place instead of deleting it.
- Keep AC IDs in the artifact layer. Do not embed them in code, comments, or
  test names; record test-to-AC mappings in a design or report.
- Use `Status: implementation-ready` only when implementation can proceed
  without inventing scope, interfaces, acceptance criteria, or verification.
- Add a `## Work Breakdown` section with stable task IDs only when multiple
  implementers need parallel dispatch, work must cross sessions, or the design
  is delivered in phases. Otherwise keep execution steps as a runtime todo.

## Decision Record Format

```markdown
# Decision Record: <title>

Design: <path to the governing design>

## D1: <decision title>

- **Direction taken**: <what was decided>
- **Alternatives rejected**: <viable options not taken>
- **Why**: <user preference, verified constraint, or evidence>
- **Affects**: <AC IDs or design sections, or `whole design`>
```

Record one `D` entry per recordable decision. Attribute a user preference as a
preference; do not invent technical justification for it.

## Research Example

```markdown
# Topic

## Question

State the bounded question and why it matters.

## Evidence

Record sources, observations, and material uncertainty.

## Conclusion

State the supported conclusion, rejected alternatives, and recommended use.
```

## Report Examples

Use the kind-specific report references rather than inventing report headings:

- `implementation-report` → `implementation-report-format.md`
- `review-report` → `review-report-format.md`
- `bug-report` → `bug-report-format.md`
- `failure-report` → `failure-report-format.md`
