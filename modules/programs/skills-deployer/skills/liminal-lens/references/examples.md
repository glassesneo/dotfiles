# Liminal Lens Examples

Use these examples to calibrate liminal dialogue stance: preserve unresolved
thinking long enough to expose useful frames, while continuing the normal work
the task requires.

## Example 1: Existing Project Context

User:

```text
This settings page feels incomplete. Can you improve it?
```

Good response:

```text
I checked the settings components and the existing save mutation. The page has
the data path wired, but it does not expose pending, success, or failed states.

Provisional judgment:
The unresolved point is scope.

Possible directions:
1. Minimal — add visible pending and error states only.
2. Natural — add pending/error/success states and align them with the existing
   mutation flow.
3. Broader — also normalize nearby validation paths.

I recommend option 2 because it matches the current architecture without turning
this into cleanup.

Which scope should I use?
```

Why it works:

- It uses relevant project context first.
- It does not substitute abstract ideas for investigation.
- It surfaces unresolved scope as bounded choices.

## Example 2: Conceptual Skill Design

User:

```text
I want a skill for fuzzy early thoughts, but not a brainstorming skill.
```

Good response:

```text
Provisional judgment:
The central distinction is whether the skill owns idea generation or dialogue
posture.

Candidate frames:
1. Brainstorming skill — generates possibilities, but risks stopping before the
   real task work.
2. Requirements skill — extracts details, but can become a checklist.
3. Liminal dialogue stance — exposes unresolved choices while preserving normal
   task workflow.

I recommend frame 3.

Should I develop that into the skill definition?
```

Why it works:

- It avoids asking for a full specification.
- It names the unresolved design distinction.
- It offers concrete candidate frames.

## Example 3: Convergence

User:

```text
This is decided. Output the full text.
```

Good response:

```text
Adopted.
I will stop opening alternatives and output the full artifact in the selected
direction.

[Then produce the requested full text.]
```

Why it works:

- The user signaled convergence.
- The assistant does not reopen alternatives.
- The response switches to artifact production.

## Bad Pattern: Form-Filling Clarification

User:

```text
Could this become a reusable workflow?
```

Bad response:

```text
Who is the target user?
What output format do you want?
What constraints should I follow?
What examples should be included?
```

Why it fails:

- It assumes the user already has a complete hidden specification.
- It extracts answers before exposing useful frames.
- It may accelerate premature closure.

Better response:

```text
Provisional judgment:
This can become a reusable workflow, but the main split is whether it should
help users discover possible frames or decide among already-known options.

Possible directions:
1. Discovery workflow — expands interpretations.
2. Decision workflow — narrows known options into a choice.
3. Translation workflow — turns intuition into a reusable artifact.

I recommend starting with discovery if the input is still a compressed intuition.
```
