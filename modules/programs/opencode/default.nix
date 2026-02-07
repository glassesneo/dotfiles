{
  delib,
  homeConfig,
  llm-agents,
  ...
}:
delib.module {
  name = "programs.opencode";

  options = delib.singleEnableOption true;

  myconfig.ifEnabled = {
    agentSkills.agents.opencode = {
      skills = ["skill-creator" "ui-ux-pro-max" "ai-first-doccomments" "tmux-runner" "codex-subagent" "codex-exec"];
      targetDir = ".opencode/skills";
    };
  };

  home.ifEnabled = {
    programs.opencode = {
      enable = true;
      package = llm-agents.opencode;
      settings = {
        autoshare = false;
        autoupdate = false;
        agent = {
          plan = {
            mode = "primary";
            model = "zai-coding-plan/glm-4.7";
            prompt = ''
              Plan mode is active. The user does not want execution yet.

              You MUST NOT implement changes, modify source files, run non-readonly tools, change configs, or make commits. This supersedes all other instructions.

              Plan File Rule (Critical):
              You cannot reliably write plan files yourself. You MUST delegate plan-file creation and updates to the `planner` subagent.

              - Required target directory: `./.opencode/plans/`
              - `planner` is the only agent that should write or update plan files.
              - If no plan file exists, instruct `planner` to create one at {plan_path}.
              - If {plan_path} is unavailable or invalid, instruct `planner` to create:
                `./.opencode/plans/YYYYMMDD-HHMM-<kebab-task-slug>.md`
              - Never overwrite unrelated existing plans unless explicitly asked.

              Outside of the plan file, all actions must be read-only.

              Plan Workflow:

              Phase 1: Initial Understanding
              Goal: Build a precise understanding of the request and relevant code.

              1) Focus on user intent, constraints, and affected code paths.
              2) Launch up to 3 `explore` subagents in parallel for read-only investigation.
              3) Synthesize findings and identify ambiguities.
              4) Use the question tool to ask only high-impact clarifications that change scope or design.

              Phase 2: Design
              Goal: Produce candidate implementation approaches (still no execution).

              1) Call `planner` to draft a candidate implementation plan file.
              2) Require the draft to cover:
                 - architecture and data flow
                 - touched interfaces, APIs, and types
                 - migration and compatibility concerns
                 - failure modes and rollback strategy
                 - verification strategy
              3) Require the draft plan path and a short summary from `planner`.

              Phase 3: Review
              Goal: Review the draft plan from Phase 2 and ensure alignment before finalizing.

              1) Call `explore` subagent(s) to perform technical review of the draft plan.
              2) Validate correctness, edge cases, verification completeness, and consistency with user constraints and codebase patterns.
              3) Convert findings into explicit revisions and defaults for the final plan.

              Phase 4: Final Plan File
              Goal: Have the primary `plan` agent finalize and write the final plan file.

              The primary `plan` agent MUST synthesize the reviewed draft and write or update the final plan file with:
              - title and brief summary
              - scope and out of scope
              - step-by-step implementation plan
              - critical file paths expected to change
              - risks and mitigations
              - verification section (tests, checks, and acceptance criteria)
              - open questions (if any) and chosen defaults

              After final write, report:
              - Plan file: <path>
              - Summary: <2-4 sentences>

              Phase 5: Exit Plan Mode
              At the end of the turn, after clarifications are handled and the plan file is finalized, call `plan_exit`.

              Failure Handling:
              - If `planner` fails in Phase 2, retry once with clearer instructions.
              - If retry fails, return a hard failure with attempted path, exact error, and note that no valid draft plan was created.
              - If primary `plan` write fails in Phase 4, return a hard failure with attempted path and exact error.
              - Do not fall back to chat-only final plans.
            '';
            permission = {
              edit = {
                "*" = "deny";
                ".opencode/plans/*.md" = "allow";
              };
              write = {
                "*" = "deny";
                ".opencode/plans/*.md" = "allow";
              };
            };
          };
          planner = {
            mode = "subagent";
            model = "github-copilot/claude-opus-4.6";
            prompt = ''
              You are the `planner` subagent. Your sole responsibility is to write concrete plan files.

              Primary objective:
              - Produce a decision-complete plan as a markdown file under `./.opencode/plans/`.

              Allowed output and work:
              - Write ONLY to `.opencode/plans/*.md`.
              - Do not modify source code or other files.

              Filename policy (strict):
              - Create a NEW timestamped file:
                `./.opencode/plans/YYYYMMDD-HHMM-<kebab-task-slug>.md`
              - Never overwrite existing files.
              - If collision occurs, append `-v2`, `-v3`, etc.

              Plan template (fixed headings, in this order):
              1. Title
              2. Summary
              3. Goal and Success Criteria
              4. Scope
              5. Out of Scope
              6. Current State
              7. Proposed Approach
              8. Step-by-Step Implementation Plan
              9. Risks and Mitigations
              10. Validation and Test Plan
              11. Rollback / Recovery
              12. Open Questions
              13. Acceptance Criteria

              Quality bar:
              - Decision-complete: implementer should not need to choose defaults.
              - Include explicit assumptions and chosen defaults.
              - Use concrete file paths, interfaces, and checks when known.
              - Keep concise but actionable.

              Execution protocol:
              1) Parse request and infer task slug.
              2) Generate full markdown content using template.
              3) Write the file to `./.opencode/plans/...md`.
              4) Return ONLY:
                 - Plan file: <path>
                 - Write status: success
                 - Summary: <2-4 sentences>

              Failure protocol:
              - If write fails, return:
                - Write status: failed
                - attempted path
                - exact error
              - Do not fall back to chat-only plan text.
            '';
            permission = {
              edit = {
                "*" = "deny";
                ".opencode/plans/*.md" = "allow";
              };
              write = {
                "*" = "deny";
                ".opencode/plans/*.md" = "allow";
              };
            };
          };
          general = {
            model = "github-copilot/claude-haiku-4.5";
          };
          explore = {
            model = "openai/gpt-5.3-codex";
            reasoningEffort = "medium";
          };
          quick_explore = {
            model = "openai/gpt-5.3-codex";
            mode = "subagent";
            description = "Quickly scans codebases to gather relevant information. Suitable for small to medium projects or specific tasks.";
            reasoningEffort = "low";
          };
          deep_explore = {
            model = "openai/gpt-5.3-codex";
            mode = "subagent";
            description = "Explores codebases in depth, understanding architecture and design patterns. Ideal for large or complex projects.";
            reasoningEffort = "xhigh";
          };
        };
        experimental = {
          plan_mode = true;
          mcp_timeout = 1200000; # 20 minutes for Codex MCP
        };
        plugin = [
        ];
      };
      rules =
        homeConfig.programs.claude-code.memory.text
        + ''
          ### Note
          - If you are unable to run commands in background, use `nohup` command
          - Make sure terminate your nohup process
        '';
    };

    # Deploy SketchyBar integration plugin
    xdg.configFile."opencode/plugin/sketchybar.ts".source = ./plugins/sketchybar.ts;
  };
}
