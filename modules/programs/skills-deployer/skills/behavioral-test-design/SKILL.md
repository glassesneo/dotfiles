---
name: behavioral-test-design
description: >-
  Use when designing, adding, changing, reviewing, or auditing tests and
  automated checks, including test-suite cleanup. Trigger when deciding what a
  test should assert, which cases materially matter, or whether an existing
  check should be kept, rewritten, or deleted. Do not use when only running
  already-defined validation commands and reporting their results.
---

# Behavioral Test Design

Decide whether a durable test is warranted before designing its contract. Use the lowest reliable mechanism that observes the material failure, and do not prove the same concern again at adjacent layers.

## Admission Decision

For each candidate behavioral test:

1. Name the plausible failure and its material consequence for a consumer.
2. Identify the behavior owner and the stable execution boundary where the failure becomes observable.
3. Inventory trusted existing guarantees that detect the same failure, including type systems, schemas, compiler and linter checks, framework validation, module types and assertions, evaluation, builds, and consumer-provided validators.
4. Admit a durable behavioral test only when all of these hold:
   - the repository owns the behavior or compatibility commitment;
   - the consequence is material;
   - no existing guarantee reliably detects the same failure;
   - a stable consumer-observable result exists; and
   - expected maintenance is proportionate to recurrence risk and consequence.

Choose one outcome:

- **no durable test**: an existing guarantee is sufficient, the consequence is immaterial, the behavior is not owned, or only unstable implementation detail can be asserted;
- **mechanical validation**: a formatter, type checker, schema or consumer validator, evaluation, build, integrity scanner, or runtime smoke check serves one distinct purpose;
- **behavioral test**: an admitted repository-owned behavioral gap remains.

## Behavioral Contract

Only after admitting a behavioral test, state its concern in one sentence:

> Given **input**, when it crosses **execution boundary**, **consumer** observes **result**.

Consumers include end users, tool and API callers, configuration authors, and runtimes that read generated artifacts.

Choose one normal path. Add only material edge cases that produce a meaningfully different consumer result. Invalid-input acceptance, partial state, cancellation, disablement, concurrency, and external failure qualify only when the mechanism actually has that condition and exposes a distinct result.

Test at the smallest stable boundary that owns the concern. Do not repeat the same contract across layers.

## Stable Assertions

- UI text: project synthetic input and state into the information a user needs; do not freeze decoration, separators, punctuation, or unrelated copy.
- Model-facing text: test only mechanical transformations of synthetic prompts, such as preservation, composition, routing, or truncation.
- Configuration: exercise an admitted override, aggregation, disablement, rejection, or generated-output contract; do not copy current defaults, inventory size, or element counts into expectations.
- Machine protocols: schemas, fields, paths, and exit statuses parsed by an external consumer are valid contracts when their compatibility risk passes admission.
- Diagnostics: assert the failure concern or category needed by a consumer, not a complete sentence.

## Existing Suite Audit

Classify each test or check:

- **keep**: it passes admission as a behavioral test or has one distinct mechanical purpose;
- **rewrite**: an admitted contract exists but the assertion fixes mutable text, defaults, inventory, source structure, or a concern owned at another layer;
- **delete**: admission fails and no distinct mechanical purpose remains.

Prefer deletion when an existing guarantee owns the concern. Add a replacement only when a material behavioral gap remains.

For every kept or rewritten behavioral test, record the admission rationale: plausible failure and consequence, owner and boundary, existing guarantees considered, stable observable, and proportionality. For every rewrite, also record the concern sentence. File-level records are sufficient for unchanged files.

For each retained mechanical check, state its unique purpose. Record residual risks intentionally left untested rather than recreating duplicate coverage.

## Output

Return or record:

- keep, rewrite, or delete decisions for audited tests and checks;
- admission rationales for kept and rewritten behavioral tests;
- the concern sentence for each new or rewritten behavioral test;
- the unique purpose of each retained mechanical check; and
- residual risks intentionally left untested.

This Skill owns test necessity and contract design. It does not own source-change lifecycle or validation execution procedures.
