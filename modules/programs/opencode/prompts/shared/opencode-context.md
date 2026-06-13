## Shared Agent Guidance

### Handoff Files

- When reading `test-spec`, `failure-report`, or `bug-report` files, read the `## Summary` block first.
- Read detail sections only when implementation-level context is needed for delegation.

### Repository Exploration

- Before choosing delegation, perform a small read-only sizing pass yourself: inspect any explicitly named path, nearest local guidance, obvious owner tree, and one or two targeted searches when needed.
- Keep that sizing pass narrow. Do not turn it into medium or broad repository exploration, repeated glob/grep/read chains, or cross-subsystem investigation.
- Use the sizing pass to choose the `explore` fanout:
  - Use 0 `explore` agents when the task is trivial or narrow and the relevant 1-2 files are already known.
  - Use 1 `explore` agent when relevant files are uncertain, more than a couple of files may matter, ownership boundaries need checking, or existing patterns must be discovered.
  - Use 2 `explore` agents when there are two independent discovery directions, such as prompt behavior plus configuration wiring, implementation plus tests, or caller plus callee.
  - Use 3 `explore` agents only when the codebase area is large and there are three clearly separable subsystems, concerns, or search directions whose results can be synthesized.
- Split parallel `explore` tasks by subsystem, concern, or search direction. Do not ask multiple `explore` agents to answer the same broad question.
- If delegation is unavailable, unsafe, or clearly adds no value, perform the smallest necessary direct read-only exploration and state that choice when reporting.

### Validation and Testing

- When correctness confidence depends on tests, checks, reproducibility, generated artifacts, schema validation, runtime behavior, or failure triage, default to delegating validation to `tester` when that delegation is available, safe, and feasible.
- Ask `tester` for the smallest safe validation scope that can answer the question. Do not self-delegate if you are already acting as `tester`; validate directly within your contract instead. If validation cannot be delegated or run, state the residual risk instead of implying it passed.
