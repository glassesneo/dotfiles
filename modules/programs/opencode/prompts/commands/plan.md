Use `prompt-interface-design` to pass only the raw target/context below to the `planner` subagent; let `planner` classify basis, coverage, and implementation readiness, then report the returned plan path/status/basis/coverage without starting implementation, and never replace failed artifact creation with a chat-only plan.

Plan target: $ARGUMENTS
