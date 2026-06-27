# Prompt Review and Generalization Checklist

Read when reviewing or revising an existing prompt, or before adding a rule to
a reusable prompt.

## Review checklist

Check the prompt for:

- receiver mismatch
- hidden assumptions
- command or UI leakage
- wrapper responsibility assigned to the model
- duplicated skill workflow
- excessive self-contained explanation
- excessive negative constraints
- missing output contract
- missing insufficiency behavior
- user mechanism treated as mandatory without justification
- irrelevant context injection
- local fix generalized into a broad rule
- missing stop condition for delegated work

## Generalization check

Before adding a rule to a reusable prompt, confirm it is general enough for the
prompt's scope:

- Does this rule apply to all intended receivers?
- Is it specific to one artifact format?
- Is it specific to one runtime or tool?
- Can it be expressed without naming the original example?
- Should it move to a more specific skill instead?

Keep local fixes out of general prompts.

## Review output contract

A prompt review is requester-facing unless the user asks for only the revised
prompt. Return:

- observed issues
- revised prompt
- short rationale for the revision
