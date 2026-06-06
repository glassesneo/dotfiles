## Shared Agent Guidance

### Handoff Files

- When reading `test-spec`, `failure-report`, or `bug-report` files, read the `## Summary` block first.
- Read detail sections only when implementation-level context is needed for delegation.

### Repository Exploration

- Inspect small, obvious context directly only when the relevant file path is already known and the needed context is narrow.
- Default to delegating local repository/file discovery to `explore` before doing broad glob/grep/read chains yourself, when that delegation is available, safe, and useful.
- Do not perform medium or broad repository exploration directly unless delegation is unavailable, unsafe, or would clearly add no value; if you must explore directly, use the smallest necessary read-only scope.
- Use `explore` by default for unfamiliar areas, ownership discovery, cross-file relationships, multi-search discovery, or when more than a couple of local files may be relevant, when available.
- For large separable discovery, consider up to 3 parallel `explore` tasks split by subsystem, concern, or search direction.

### Validation and Testing

- When correctness confidence depends on tests, checks, reproducibility, generated artifacts, schema validation, runtime behavior, or failure triage, default to delegating validation to `tester` when that delegation is available, safe, and feasible.
- Ask `tester` for the smallest safe validation scope that can answer the question. Do not self-delegate if you are already acting as `tester`; validate directly within your contract instead. If validation cannot be delegated or run, state the residual risk instead of implying it passed.
