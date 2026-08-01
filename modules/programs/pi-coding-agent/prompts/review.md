---
description: Adaptively review an optional target, defaulting to current worktree changes
argument-hint: "[target/context]"
---
Load and execute the `adaptive-review` Skill in `auto` mode.

Target: $ARGUMENTS

When no target is supplied, review all staged, unstaged, and untracked
current-worktree changes, excluding ignored files. Do not require or invent an
implementation report or approved design. If the default target has no
reviewable diff, persist an inconclusive review report rather than claiming no
findings.
