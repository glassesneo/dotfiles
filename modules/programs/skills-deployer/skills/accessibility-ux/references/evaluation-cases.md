# accessibility-ux Evaluation Cases

Use these optional cases to check whether the skill routes correctly and remains useful across the UI lifecycle.

## Positive Triggers

- "Add acceptance criteria for keyboard and screen-reader support to this modal spec."
- "Plan implementation of a custom combobox with focus management and ARIA state."
- "Implement this form so validation errors are accessible."
- "Review this diff for WCAG 2.2 AA and UX regressions."
- "Refactor the dialog component without changing focus behavior or announcements."

Expected behavior: load `accessibility-ux`, inspect the task phase, and return phase-appropriate guidance or findings.

## Negative Triggers

- "Make this card look more premium" with no usability, interaction, or accessibility concern.
- "Explain legal ADA compliance obligations for this product."
- "Create a new Agent Skill package for database migrations."
- "Optimize a backend query" with no user-facing UI state or error behavior.

Expected behavior: do not load this skill unless accessibility/UX behavior becomes part of the task.

## Boundary Cases

- "Change button color tokens" should trigger only if contrast, state cues, or design-system accessibility behavior is in scope.
- "Refactor React components" should trigger only for components whose user-facing semantics, focus, keyboard, forms, errors, or responsive behavior might change.
- "Add a toast" should trigger when the toast communicates status, errors, or task completion.

Expected behavior: ask or record scope if accessibility/UX impact is unclear and material.

## Overlap Cases

- With `refactor-maintainability`: use both when the task is a behavior-preserving UI refactor; `accessibility-ux` owns UI accessibility/UX invariants.
- With `skill-architect`: use `skill-architect` when designing this skill package; use `accessibility-ux` when performing accessibility/UX work.
- With `prompt-interface-design`: use `prompt-interface-design` for model-facing prompt interfaces; use `accessibility-ux` when the prompt concerns UI accessibility/UX requirements.

## Regression Cases

- A review-only answer for a spec-planning request is a regression.
- A response that says automated checks passing proves accessibility is a regression.
- A custom widget plan without keyboard and focus behavior is a regression.
- A refactor plan that preserves visual output but ignores accessible names, roles, states, or focus order is a regression.

## Malformed or Sparse Input Cases

- If the UI component type is missing, ask for it or state assumptions before prescribing roles and keyboard behavior.
- If there is no design-system context, use semantic HTML and WCAG 2.2 AA defaults rather than inventing product rules.
- If the request asks for legal certification, decline the legal conclusion and offer technical accessibility evaluation criteria.

## Safety and Packaging Cases

- The skill must not package secrets, private endpoints, hidden behavioral overrides, or executable scripts.
- Required execution behavior belongs in `SKILL.md`; this reference must stay optional.
- Deployment defaults are `.agents/skills` and `.claude/skills` unless a separate spec changes them.
