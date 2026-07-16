---
name: accessibility-ux
description: >-
  Use when UI accessibility or usability must shape specification planning,
  implementation planning, implementation, code/design review, or
  behavior-preserving refactoring. Trigger on work involving WCAG, semantic
  HTML, ARIA, keyboard operation, focus management, screen-reader support,
  forms, errors, contrast, reflow, status messages, or UX heuristics. Do not use
  for purely visual taste changes, legal compliance advice, framework-specific
  accessibility manuals, generic skill-authoring, or non-UI work unless
  accessibility/UX behavior is part of the task contract.
---

# Accessibility UX Skill

## Purpose

Build accessibility and usability into UI work before it becomes a review-only
checklist.

Use WCAG 2.2 AA as the default baseline. Prefer semantic HTML first, then ARIA
only when needed, and verify with both automated checks and manual task flows.

The goal is to prevent users from being unable to perceive, operate, understand,
recover from, or use UI with assistive technologies.

## When to Use / Not Use

Use this skill for UI work that touches specifications, implementation, review,
or refactoring when the task involves semantics, keyboard behavior, focus,
screen-reader output, forms, error recovery, responsive behavior, or UX
heuristics.

Do not use it for legal compliance advice, purely aesthetic review, framework
APG catalogs, product-specific design-system rules, generic skill creation, or
non-UI code that does not affect user-facing interaction.

## Core Practices

- Prefer native HTML controls and landmarks before ARIA.
- Keep names, roles, states, values, focus, and keyboard behavior synchronized.
- Preserve visible focus and avoid color-only state or error signaling.
- Make status, loading, success, failure, and validation feedback textual.
- Keep DOM order, reading order, visual order, and focus order aligned unless a
  documented exception is tested.
- If a custom widget is unavoidable, define keyboard operation, focus handling,
  announcements, and recovery explicitly.

## Planning and Review

For planning, identify the main user tasks, failure/recovery paths, keyboard
paths, focus behavior, semantic structure, and verification method.

For review, check DOM semantics, operation, focus, visual responsiveness,
screen-reader experience, and UX recovery. Report only issues with concrete
user impact or clear implementation risk.

## References

- `references/output-contracts.md`: use for spec, implementation-note, and
  review-finding templates, plus severity guidance.
- `references/common-failures.md`: use for the concrete failure checklist and
  verification prompts.
