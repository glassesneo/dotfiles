---
name: accessibility-ux
description: Use when UI accessibility or usability must shape specification planning, implementation planning, implementation, code/design review, or behavior-preserving refactoring. Trigger on work involving WCAG, semantic HTML, ARIA, keyboard operation, focus management, screen-reader support, forms, errors, contrast, reflow, status messages, or UX heuristics. Do not use for purely visual taste changes, legal compliance advice, framework-specific accessibility manuals, generic skill-authoring, or non-UI work unless accessibility/UX behavior is part of the task contract.
---

# Accessibility UX Skill

## Purpose

Build accessibility and usability into UI work before it becomes a review-only checklist.

Use WCAG 2.2 AA as the default implementation and review baseline. Supplement it with UX heuristics, inclusive-design thinking, and manual task checks. Do not claim legal compliance or complete accessibility from this skill alone.

The goal is to prevent users from being unable to perceive, operate, understand, recover from, or use UI with assistive technologies.

## When to Use / Not Use

Use this skill for UI work that touches:

- specifications, acceptance criteria, plans, implementation, reviews, or refactors
- semantic HTML, ARIA, accessible names, roles, states, and values
- keyboard access, focus order, focus visibility, focus trapping, or focus return
- screen-reader-relevant structure, live regions, status messages, headings, or landmarks
- forms, labels, instructions, validation, error messages, or recovery flows
- contrast, color-only state, zoom, reflow, responsive layouts, motion, or fixed/sticky UI
- UX feedback, user control, consistency, error prevention, recognition over recall, or help

Do not use this skill for:

- legal compliance opinions or jurisdiction-specific policy advice
- purely aesthetic preference review with no usability or accessibility effect
- full WCAG, ARIA Authoring Practices, browser, or screen-reader compatibility matrices
- product-specific design-system rules unless the current task provides them
- generic skill creation or prompt design unless the skill being created is accessibility/UX-specific
- non-UI code unless it changes user-facing interaction, content, error recovery, or assistive-technology output

## Baseline Concepts

- **POUR**: Check whether content is perceivable, operable, understandable, and robust.
- **WCAG 2.2 AA**: Treat AA as the default baseline. Use AAA only when the task explicitly requires it or a local standard already does.
- **Semantic HTML first**: Use native elements and attributes before ARIA. Prefer `button`, `a href`, `label`, `input`, `select`, `textarea`, `fieldset`, `legend`, `table`, `dialog`, headings, lists, and landmarks when their semantics match.
- **ARIA as a contract**: If custom UI needs ARIA, keep role, accessible name, state, property, value, DOM focus, and keyboard behavior synchronized.
- **Screen-reader support**: Evaluate DOM semantics, accessibility tree output, names, descriptions, reading order, headings, landmarks, form associations, and live/status announcements. Do not treat screen-reader testing as a complete WCAG oracle.
- **UX heuristics**: Use visibility of system status, user control, consistency, error prevention, recognition over recall, efficient paths, minimal cognitive load, recovery, and help as supplements to WCAG.

## Inputs to Inspect

Inspect the smallest useful set for the task:

1. User goal, confirmed spec, plan, issue, PR, or design description
2. Target users, primary tasks, input modes, device constraints, localization, and error/recovery scenarios
3. UI states: loading, empty, disabled, selected, expanded, invalid, submitted, failed, offline, permission denied
4. Existing components, design-system conventions, and local accessibility utilities
5. Markup, roles, labels, state attributes, focus code, keyboard handlers, routing, and dynamic updates
6. Tests, snapshots, storybook/playwright fixtures, axe checks, visual tests, or manual QA notes
7. Public behavior that users or assistive technologies may observe: text, DOM order, focus order, announcements, keyboard shortcuts, error messages, URLs, and persisted values

If missing information can change scope, public behavior, acceptance criteria, or whether users can complete a task, ask for clarification or record a conservative default. Do not invent accessibility requirements that conflict with the confirmed spec.

## Specification Planning

When shaping a UI spec, add accessibility and UX requirements at contract level:

- Identify the primary user tasks and failure/recovery paths.
- State supported input methods, including keyboard-only operation.
- Require every interactive function to be reachable, operable, and escapable by keyboard.
- Require focus order to follow visual and semantic order.
- Require visible focus and prevent focused controls from being fully obscured.
- Require meaningful names, roles, states, values, headings, landmarks, and form associations.
- Require status, loading, success, failure, and validation feedback in text, not color alone.
- Require forms to have persistent labels, instructions, error identification, and correction guidance.
- Require responsive, zoomed, and reflowed layouts to preserve information and function.
- Decide user-control needs such as Cancel, Undo, Back, confirmation, timeout extension, or retry.

Acceptance criteria should describe observable outcomes, not implementation mechanics, unless native semantics or keyboard behavior is itself the contract.

## Implementation Planning

For each UI component or flow, plan these dimensions:

1. **Meaning**: native element choice, heading/landmark placement, form grouping, table/list structure.
2. **Operation**: keyboard keys, pointer behavior, touch target, drag alternative, shortcut conflicts, escape routes.
3. **Focus**: entry point, tab order, focus trap if modal, focus restoration, focus visibility, scroll/obscuring behavior.
4. **Name and state**: accessible name source, description, role, `aria-expanded`, `aria-selected`, `aria-current`, `aria-invalid`, disabled state, value changes.
5. **Notification**: whether dynamic changes need a status message, live region, inline text, or no announcement.
6. **Errors and recovery**: prevention, validation timing, error summary, field-level messages, correction suggestions, retry/undo/cancel.
7. **Responsive behavior**: zoom, text resize, 320 CSS px reflow, orientation, virtual keyboard, sticky headers/footers.
8. **Verification**: automated checks, keyboard path, screen-reader spot check, responsive/zoom check, and manual task completion.

Prefer native HTML controls. If a custom widget is unavoidable, cite the expected ARIA/APG-like pattern and explicitly plan keyboard and state synchronization.

## Implementation Guardrails

- Do not put click handlers on `div` or `span` when a native interactive element fits.
- Use `button` for actions and `a href` for navigation.
- Do not remove focus outlines unless replacing them with an equally visible focus indicator.
- Do not rely on placeholder text as the only label.
- Do not convey state, errors, required fields, or selection by color alone.
- Give icon-only controls a concise accessible name.
- Ensure visible labels and accessible names describe the same purpose.
- Connect descriptions and errors with programmatic associations such as `aria-describedby` when appropriate.
- Set `aria-invalid="true"` only after validation fails, not before user input or validation.
- Move focus into modal dialogs and restore it to the invoking control when the dialog closes.
- Provide a close path such as Esc and a visible close/cancel control when users can be trapped in a layer.
- Avoid toasts as the only place for important results or errors.
- Avoid positive `tabindex` unless there is a documented, tested reason.
- Keep DOM order, reading order, visual order, and focus order aligned unless a documented exception is tested.

## Review Procedure

Separate findings by evidence type:

1. **DOM and semantics**: headings, landmarks, lists, tables, forms, labels, roles, names, descriptions, states, duplicate IDs, hidden content.
2. **Operation**: Tab, Shift+Tab, Enter, Space, arrow keys when relevant, Esc, Home/End for composite widgets, keyboard traps, drag alternatives.
3. **Focus**: visible indicator, logical order, modal trap, focus return, scroll into view, fixed/sticky obstruction.
4. **Visual and responsive**: contrast, non-color cues, zoom, reflow, text resize, motion, small screens, virtual keyboard.
5. **Screen-reader experience**: names, roles, states, reading order, announcements, live regions, error summaries, status messages.
6. **UX heuristics**: feedback, user control, consistency, error prevention, recognition over recall, recovery, help, cognitive load.

Report only issues with concrete user impact or clear implementation risk. A standard violation, confusing interaction, or missing verification can be enough when it can block or mislead users.

## Refactor Invariants

Before refactoring UI code, state what must remain true:

- Visible labels and accessible names continue to identify the same purpose.
- Names, roles, states, values, and descriptions remain correct and synchronized.
- Keyboard reachability, operation, escape routes, and focus order are preserved.
- Focus indicators remain visible and focused elements are not fully obscured.
- Modal, menu, popover, and route transitions preserve intended focus movement and restoration.
- Form labels, `fieldset`/`legend`, descriptions, required indicators, validation timing, errors, and correction guidance remain associated.
- Error text, status text, and recovery options remain available outside color alone or transient toasts.
- Contrast, zoom, reflow, text resize, and responsive operation do not regress.
- Live-region and status-message announcements are neither removed nor made noisy.
- Heading hierarchy, landmarks, reading order, and DOM order remain meaningful.
- Critical user controls such as Cancel, Undo, Back, Retry, or confirmation are not removed accidentally.

If current accessibility behavior is under-specified, add characterization checks or inspect current behavior before changing structure.

## Verification Strategy

Use automated checks for what tools can reliably detect:

- missing alt text, labels, duplicate IDs, invalid ARIA, some role/name problems
- some color contrast failures
- heading/landmark/form structure warnings
- basic WCAG violations caught by tools such as axe, WAVE, lint rules, or component tests

Use manual checks for what tools cannot prove:

- full keyboard task completion and escape paths
- focus movement after dynamic changes, routes, dialogs, menus, and errors
- whether names, descriptions, and announcements make sense in context
- screen-reader task experience and reading order
- error prevention, correction, recovery, and cognitive load
- zoom, reflow, responsive layout, virtual keyboard, and sticky obstruction behavior

Do not say accessibility passed only because automated checks passed. State which checks ran, which did not, and remaining risk.

## Output Contracts

For specs or plans, include:

```markdown
## Accessibility / UX Contract

- User tasks and affected users:
- Required keyboard behavior:
- Focus behavior:
- Semantics and names:
- Forms/errors/status messages:
- Responsive/zoom/reflow behavior:
- UX recovery/control requirements:
- Verification:
- Open questions or defaults:
```

For implementation notes, include:

```markdown
## Accessibility / UX Implementation Notes

- Semantic choices:
- ARIA used or avoided, with reason:
- Keyboard and focus behavior:
- Error/status behavior:
- Responsive/visual behavior:
- Verification run:
- Remaining risk:
```

For review findings, use:

```markdown
- Severity: high | medium | low
- Evidence: <file:line, UI state, or reproduction step>
- Affected user/task impact: <who is blocked, misled, slowed, or burdened>
- Basis: <WCAG 2.2 AA / ARIA / semantic HTML / UX heuristic>
- Recommendation: <smallest safe fix>
- Verification: <automated and/or manual check>
```

Use high severity when users cannot complete a core task, keyboard users are trapped, critical controls lack names, form submission errors cannot be understood or corrected, or focus/order changes make the flow unusable. Use medium for likely task failure, assistive-technology confusion, or recurring patterns that can block some users. Use low for local friction with limited task impact.

## Common Failures to Check

- ARIA added to repair avoidable non-semantic HTML.
- `outline: none` removes focus visibility.
- Click works but Enter or Space does not.
- Icon button has no accessible name.
- Placeholder is the only label.
- Error is shown only by color or is not connected to the field.
- Important result appears only in a transient toast.
- Modal opens without moving focus or closes without restoring focus.
- Fixed or sticky UI hides focused controls.
- Custom select, tab, menu, or combobox lacks expected keyboard behavior.
- Responsive layout changes reading or focus order incorrectly.
- Infinite scroll or dynamic updates lose position or announce too much.
- Automated checks pass and the work is incorrectly treated as fully accessible.
