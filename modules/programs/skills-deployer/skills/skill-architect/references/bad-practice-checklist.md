# Bad Practice Self-Audit Checklist

In Step 13, use this checklist for manual review in addition to the mechanical checks performed by `scripts/lint_skill.py`. This checklist is based on Section 2, Bad Practices, and Section 4, Defensive Rules, of the user-provided agent-skills best practices document.

Items that are hard to detect mechanically, such as overly broad responsibility, misleading wording, and safety boundary quality, must be judged by a human here.

## Excessive Responsibility

* [ ] Does the skill avoid packing research, design, implementation, review, testing, and release into one skill?
* [ ] Is the name not overly broad, such as `xxx-helper`, `xxx-tools`, or `general-xxx`?
* [ ] Was overlap with existing skills checked before creating a similar skill?
* [ ] Is the skill named by work unit, not only by domain?
* [ ] Are multiple distinct workflows not forced into one procedure?

## Bad Trigger

* [ ] Is the description not too broad?
* [ ] Does it avoid superlatives that do not help selection?
* [ ] Are the main trigger conditions not buried late in the description?
* [ ] Are non-use conditions written?
* [ ] Are boundaries with similar skills written?
* [ ] Does it avoid stuffing search terms so heavily that false activation becomes likely?

## Unexecutable Instructions

* [ ] Does it avoid ending with undefined instructions such as "judge appropriately"?
* [ ] Is the execution order clear?
* [ ] Are there branches for missing input?
* [ ] Is the output format fixed?
* [ ] Are completion conditions observable?

## Verbose Prose

* [ ] Does it avoid lengthy explanations of general knowledge the LLM is expected to know?
* [ ] Does it avoid repeating the same prohibition under multiple headings?
* [ ] Is the background section not longer than the procedure?
* [ ] Are examples not so numerous that they bury the main procedure?
* [ ] Does `SKILL.md` remain a procedure, not a textbook-like list of knowledge?

## Vague Wording

* [ ] Are terms such as "good", "clean", "robust", or "safe" not used without definition?
* [ ] Are verbs such as "review", "research", "improve", and "organize" decomposed into concrete actions?
* [ ] Are there no "latest information" claims without source and timestamp requirements?

## Insufficient Validation

* [ ] Are there at least 3 evaluation tasks?
* [ ] Is validation not limited to the happy path?
* [ ] Is there a negative trigger test?
* [ ] If the skill generates artifacts, are syntax and diff validation methods included?

## Script Overuse

* [ ] Is script use avoided where natural-language procedure is sufficient?
* [ ] Does no script delegate judgment back to the LLM?
* [ ] Are script inputs, outputs, and failure messages defined?
* [ ] Are dependency packages and execution environment specified?

## Bad Reference Files

* [ ] Do reference file names reveal their content instead of using vague names such as `reference.md`?
* [ ] Are references not deeply nested?
* [ ] Is the purpose of each referenced file clear from `SKILL.md`?

## Safety Risks

* [ ] Does the skill avoid deletion, sending, billing, publishing, and permission changes without confirmation?
* [ ] Does it handle the risk of secrets appearing in logs or generated artifacts?
* [ ] Does it avoid trusting third-party skills or external code without review?
* [ ] If there are no destructive operations, is that stated explicitly rather than omitted?

## Unmaintainable Design

* [ ] Is there a way to record change reasons and evaluation results?
* [ ] If the skill purpose changes, does the maintenance policy require renaming the skill?
* [ ] Is periodic overlap review with existing skills assumed?
