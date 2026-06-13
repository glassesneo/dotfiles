---
name: implement-via-cursor
description: Use when a confirmed spec and final plan exist and the user deliberately chooses Cursor CLI (cursor-agent) for implementation.
---

# Implement via Cursor CLI

Use this skill to hand confirmed planning artifacts to Cursor CLI for source-changing implementation.

## Prerequisites

All of the following must be true before invoking Cursor CLI:

1. A confirmed spec exists under `.agents/specs/`.
2. A final plan exists under `.agents/plans/` and references that spec.
3. The user explicitly chose Cursor CLI for implementation after planning is complete.
4. The final plan is detailed enough to constrain scope, file targets, and verification.

Do not use this skill from a planning-only workflow.

## Invocation

- Preferred input: confirmed spec path, final plan path, and any review gate result.
- The invoking session orchestrates Cursor CLI and should not perform the planned source edits itself unless the user explicitly changes direction.
- If the invoking session cannot run the required `cursor-agent` commands, stop and ask the user to rerun from a session with permission to execute Cursor CLI.

## Artifact Priority

When building the prompt sent to Cursor CLI, preserve this priority:

```text
spec > existing implementation report > plan
```

- Read the confirmed spec first.
- If an implementation report already exists for this work, read it after the spec and before relying on the plan.
- Treat the plan as implementation strategy derived from the spec, not a replacement for the spec contract.

## Safety Warning

`cursor-agent --trust --force` grants Cursor write access and command execution in the workspace. Use it only when a detailed confirmed spec and final plan exist. Do not invoke it for exploratory or underspecified work.

## Pre-flight Checks

Run these from the target workspace before starting implementation:

```bash
cursor-agent --version
cursor-agent status
cursor-agent models
```

If authentication or model availability is uncertain, report the issue and stop before `--force` invocation.

## New Session Invocation

Start a new Cursor CLI implementation session:

```bash
cursor-agent --print --trust --force --workspace "$PWD" --model composer-2.5 --output-format text "$PROMPT"
```

Build `$PROMPT` to include:

- confirmed spec path
- final plan path
- review gate result, if any
- explicit instruction to read the spec first, then any existing implementation report, then the plan
- scope boundaries from the spec
- instruction to stay within the confirmed spec and plan
- instruction to pause and report on material mismatch instead of silently diverging
- instruction to validate when feasible
- instruction to write an implementation report under `.agents/reports/` using the `after-implementation-report` Cursor skill contract

## Resume Session

List prior sessions when resuming:

```bash
cursor-agent ls
```

Resume an existing session:

```bash
cursor-agent --resume "$CHAT_ID" --print --trust --force --workspace "$PWD" --model composer-2.5 --output-format text "$PROMPT"
```

Resume prompts must repeat artifact priority (`spec > existing implementation report > plan`) and restate any material mismatch or validation obligations still open.

## Material Mismatch Handling

If Cursor reports or you detect a material mismatch with the confirmed spec or final plan:

1. Stop further implementation.
2. Report the mismatch, affected files, and proposed resolution.
3. Do not treat the mismatch as approved unless the user explicitly approves a spec or plan update.

## Validation Expectations

When feasible, require Cursor to run relevant checks before finishing (for example Nix parse/format checks, targeted tests, or repository `just` recipes named in the plan). Record commands run, outcomes, and any checks skipped with reason.

## Implementation Report Obligations

After implementation, Cursor must produce an implementation report compatible with the shared report contract:

- path under `.agents/reports/YYYYMMDD-HHMM-<kebab-task-slug>.md`
- sections: Summary, Changed Files, Spec Alignment, What Was Implemented, Plan Deviations, Spec Deviations, Reason for Deviations, Validation Results, Unresolved Items, Reviewer Notes, Known Risks, Follow-up Required
- spec and plan paths at the top

Ensure the Cursor `after-implementation-report` skill is available in `~/.cursor/skills/after-implementation-report/` (reload Cursor or start a new session after Home Manager deploys it).

## Post-handoff Summary

After Cursor CLI returns, summarize for the user:

- Spec file: <path>
- Plan file: <path>
- Implementation report: <path or not produced with reason>
- Changed files: <brief list>
- Validation: <brief outcome>
- Material mismatches or follow-up: <brief list or none>
