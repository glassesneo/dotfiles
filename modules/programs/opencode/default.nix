{
  delib,
  llm-agents,
  ...
}:
delib.module {
  name = "programs.opencode";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    programs.opencode = {
      enable = true;
      package = llm-agents.opencode;
      settings = {
        command = {
          review = {
            template = ''
            '';
            agent = "code_reviewer";
            subtask = true;
          };
        };
        autoshare = false;
        autoupdate = false;
        default_agent = "spec";
        agent.plan.disable = true;
        experimental = {
          plan_mode = true;
          mcp_timeout = 1200000;
        };
        plugin = [];
      };
      rules =
        builtins.readFile ../../../docs/agents/shared-methodology.md
        + ''

          ## OpenCode-Specific Guidance

          ### Notes
          - If you are unable to run commands in background, use `nohup` command.
          - Make sure to terminate your nohup process.

          ### Agent Switching
          - Primary agents `orchestrator`, `spec`, `respec`, `debugger`, `test_designer`, and `build` should proactively delegate to appropriate subagents on a best-effort basis.
          - After implementation, run review with `code_reviewer`.
          - `spec` must complete specification elicitation and resolve/default material ambiguities before draft planning.
          - `respec` must validate inferred specifications with the user before delegating confirmed discrepancies to `spec`.
          - Ignore backward compatibility unless explicitly specified.
          - When reading `test-spec`, `failure-report`, or `bug-report` files, read the `## Summary` block first.
          - Read detail sections only when implementation-level context is needed for delegation.
        '';
    };
  };
}
