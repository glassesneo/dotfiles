Load `staged-agent-workflow` and execute profile `plan-then-implement`.

Local capability mapping:
- implementation planner: `taskmaster` (active agent)
- source-changing implementer: `taskmaster` (active agent)
- validation runner: `tester`
- read-only reviewer: `review-orchestrator`
- report writer: the responsible capability using `agent-reports`

Target/context: $ARGUMENTS
