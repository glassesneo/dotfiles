---
name: parallax-reflection
description: >-
  Use after producing code, a plan, a review, or a technical artifact when the
  same agent should re-read its own output through a verification lens before
  finalizing. Externalize behavior in natural language, trace representative
  flows, expose assumptions, compare the explanation against specifications and
  observable evidence, and classify concrete defects or unresolved risks. This
  skill provides review perspectives and verification criteria, not an
  implementation workflow. Do not use for open-ended ideation, stylistic
  polishing, broad refactoring, or independent third-party review.
---

# Parallax Reflection

Defensive self-review for an agent reading its own output. Treat the artifact
as an unverified hypothesis, not a finished product.

## Core loop

1. Externalize behavior, not intention.
2. Trace at least one normal path and one failure or boundary path when
   behavior matters.
3. Expose assumptions fixed during implementation.
4. Check the explanation against external evidence.
5. Classify findings, risks, non-issues, and out-of-scope observations.
6. Apply the Fix Gate before changing anything.

## Generator vs verifier mode

- Generator: satisfy the spec, adapt to surrounding code, and make the smallest
  reasonable change.
- Verifier: distrust your own assumptions, match explanation to code, read
  boundaries and failure paths, and demand evidence before fixing.

Prefer observable behavior over remembered intent.

## Rubber Duck explanation

Explain the code's observable meaning, not the reasoning used to create it.
Cover inputs, outputs, state changes, persistence, side effects, exceptions,
error responses, branch conditions, caller contract, and the range deliberately
left unhandled.

Look for mismatches:
- a condition in the explanation that is absent in code
- a condition in code that is absent from the explanation
- only the happy path is explainable
- failure-path results are vague
- caller impact is missing

## Evidence first

The biggest self-review trap is mistaking the explanation's internal coherence
for evidence.

Prefer external evidence over self-evaluation. Use this order:

1. User request
2. Spec
3. Acceptance criteria
4. API contract
5. Type definitions
6. Existing code
7. Tests
8. Lint, typecheck, and build results
9. Runtime output
10. Logs
11. Model inference

Classify each item as:
- Finding: backed by evidence
- Risk: evidence is insufficient
- Non-issue: checked and refuted
- Out-of-scope: valid but outside this change

See `references/evidence.md` for the full evidence and classification model.

## Perspectives

Select the relevant perspectives; do not force every one on every review.
Use `references/perspectives.md` for the detailed trace and review lenses.
Use `references/assumptions.md` for the assumption taxonomy.

## Fix Gate

Fix only: spec violations, type errors, test failures, API-contract violations,
broken existing callers, unhandled failure paths, data-integrity risks, missing
permission boundaries, and unimplemented user requirements.

Do not fix: preference-driven redesign, unrelated refactors, out-of-spec
improvements, evidence-free anxiety, style preferences, speculative future
requirements, or changes made just to justify the review.

## Output contract

Report:
- Reviewed scope
- Behavior explanation
- Assumptions exposed
- Evidence checked
- Trace notes
- Findings
- Risks
- Non-issues rejected
- Out-of-scope observations
- Verification suggestions

Finding format:
- Severity
- Location
- Evidence
- Violated expectation
- Minimal correction
- Verification method

No findings format:
- Findings: none found
- Evidence checked: ...
- Assumptions still unverified: ...
- Residual risk: ...

## Principles

- Explain behavior, not intention.
- Treat explanation as a probe, not proof.
- Prefer external evidence over self-evaluation.
- Separate findings from risks.
- Do not fix without a concrete defect.
- Preserve implementation context, but distrust implementation assumptions.
- Review through perspectives, not through a single vague pass.
- Record remaining uncertainty instead of inventing confidence.
