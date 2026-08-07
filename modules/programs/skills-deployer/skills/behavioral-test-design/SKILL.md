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

Define the smallest stable contract that proves a consumer-observable behavior or a distinct mechanical validation purpose.

## Behavioral Contract

Before adding or retaining a behavioral test, state its concern in one sentence:

> Given **input**, when it crosses **execution boundary**, **consumer** observes **result**.

Consumers include end users, tool and API callers, configuration authors, and runtimes that read generated artifacts.

Choose one normal path. Add only material edge cases that produce a meaningfully different consumer result. Invalid-input acceptance, partial state, cancellation, disablement, concurrency, and external failure qualify only when the mechanism actually has that condition and exposes a distinct result.

Test at the smallest stable boundary that owns the concern. Do not repeat the same contract across layers.

## Stable Assertions

- UI text: project synthetic input and state into the information a user needs; do not freeze decoration, separators, punctuation, or unrelated copy.
- Model-facing text: test only mechanical transformations of synthetic prompts, such as preservation, composition, routing, or truncation.
- Configuration: exercise override, aggregation, disablement, rejection, or generated output; do not copy current defaults, inventory size, or element counts into expectations.
- Machine protocols: schemas, fields, paths, and exit statuses parsed by an external consumer are valid contracts.
- Diagnostics: assert the failure concern or category needed by a consumer, not a complete sentence.

Formatters, type checkers, schema validators, link and path integrity scanners, and build or evaluation gates are not behavioral tests. Keep them when they have a concrete mechanical purpose and identify that purpose explicitly.

## Existing Suite Audit

Classify each test or check:

- **keep**: it already states a behavioral contract or distinct mechanical validation purpose;
- **rewrite**: a stable behavioral contract exists but the assertion currently fixes mutable text, defaults, inventory, or source structure;
- **delete**: no consumer-observable behavior or distinct mechanical purpose can be stated.

Prefer deletion when the contract is absent. Add a replacement only when a real execution boundary and material risk remain.

For every rewrite, record the input, execution boundary, consumer, and observable result in one sentence. For unchanged files, a file-level audited record is sufficient.

## Output

Return or record:

- the concern sentence for each new or rewritten behavioral test;
- keep, rewrite, or delete decisions for audited tests and checks;
- the distinct purpose of retained non-behavioral checks;
- any residual risk that remains untested.

This Skill chooses test contracts. It does not own source-change lifecycle or validation execution procedures.
