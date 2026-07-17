# Default approach

Prefer local evidence first.

Inspect the repository, tests, configs, lockfiles, runtime behavior, and logs before using external tools.

Use external sources(MCP servers) only if an important unknown remains after local investigation.
Important unknowns include anything that may affect correctness, API usage, version compatibility, security, platform behavior, debugging direction, or implementation strategy.

# MCP servers

Use Context7 for current library / framework docs and up-to-date API or config references.
Coverage is incomplete. Missing results do not imply nonexistence.

Use DeepWiki for complex situations involving a specific library, especially when dynamic interaction with Devin may surface useful hints or debugging direction.
Treat it as guidance, not unquestionable truth.

Use Brave Search only when built-in cached search is stale or when fresh results are required.
Prefer official docs, changelogs, release notes, maintainers, and primary sources.

# Escalation guideline

Default escalation path:
1. local repo / runtime evidence
2. Context7
3. DeepWiki
4. Brave Search

Use the shortest reliable path.
Do not guess exact APIs, config keys, version-specific behavior, or recent changes.
If external evidence changes the solution, state what was unknown, which source resolved it, and whether any repo-local assumption conflicted with it.

# Subagent workflow

Use subagents proactively when they improve correctness, speed, or risk control. Prefer early delegation of independent work while continuing the critical-path work locally.

- `explorer` for read-only repository navigation and ownership/risk discovery.
- `researcher` for external facts that affect correctness, API usage, compatibility, security, or implementation direction.
- `reviewer` for scoped code review with a durable report.
- `tester` for test/build execution and failure triage.
- `debugger` for reproduction and root-cause investigation.

Standing delegation policy:

- For non-trivial implementation, review, or planning work, start with focused repository exploration; run up to 3 independent `explorer` agents in parallel when there are distinct questions to answer.
- For material uncertainty about external APIs, libraries, framework/version behavior, standards, security requirements, or current platform behavior, delegate a focused question to `researcher` before committing to an affected design or finding.
- After implementing non-trivial changes, delegate a scoped review to `reviewer` before completion.
- After behavior-changing, test-changing, build-affecting, or medium/high-regression-risk implementation, delegate relevant validation to `tester` before completion.
- When a reproducible failure has unclear root cause or broad impact, delegate investigation to `debugger`; use the resulting report to constrain the fix.
- For a trivial task or when no agent adds meaningful evidence, direct work is acceptable; state briefly why delegation was skipped when reporting completion.

During planning or other read-only work, use only read-only exploration or external research that does not create workspace artifacts; keep research conclusions inline unless writing is permitted in the current mode.

The parent Codex session owns orchestration, implementation decisions, integration, and final synthesis. Keep recursion bounded: do not ask child agents to spawn additional agents unless the user expressly requires nested delegation.

# Agent artifacts

- External research artifacts belong in `.agents/research/`.
- Review artifacts belong in `.agents/review-reports/`, validation failures in
  `.agents/failure-reports/`, and debugging handoffs in `.agents/bug-reports/`.
- Read the `## Summary` section of a returned artifact before loading detail sections.
- Treat artifact conclusions as input evidence, not as permission to broaden implementation scope.
- File-writing subagents may write their designated artifact only; they must not edit source files, configuration, tests, lockfiles, or Git state.
