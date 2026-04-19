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

Use Readability to extract the body of a known URL into Markdown when the page is noisy or difficult to inspect directly.
It is not a discovery tool.

Use Brave Search only when built-in cached search is stale or when fresh results are required.
Prefer official docs, changelogs, release notes, maintainers, and primary sources.

# Escalation guideline

Default escalation path:
1. local repo / runtime evidence
2. Context7
3. DeepWiki
4. Brave Search
5. Readability for selected URLs

Use the shortest reliable path.
Do not guess exact APIs, config keys, version-specific behavior, or recent changes.
If external evidence changes the solution, state what was unknown, which source resolved it, and whether any repo-local assumption conflicted with it.
