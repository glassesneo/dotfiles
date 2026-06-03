## Shared Agent Guidance

### Handoff Files

- When reading `test-spec`, `failure-report`, or `bug-report` files, read the `## Summary` block first.
- Read detail sections only when implementation-level context is needed for delegation.

### Repository Exploration

- Inspect small, obvious context directly only when the relevant file path is already known and the needed context is narrow.
- Prefer delegating local repository/file discovery to `explore` before doing broad glob/grep/read chains yourself.
- Use `explore` for unfamiliar areas, ownership discovery, cross-file relationships, multi-search discovery, or when more than a couple of local files may be relevant.
- For large separable discovery, consider up to 3 parallel `explore` tasks split by subsystem, concern, or search direction.
