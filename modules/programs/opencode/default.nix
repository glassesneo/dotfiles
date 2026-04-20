{
  delib,
  lib,
  llm-agents,
  ...
}:
delib.module {
  name = "programs.opencode";

  options = delib.singleEnableOption true;

  home.ifEnabled = let
    inherit (lib.attrsets) recursiveUpdate;
    inherit (lib.attrsets) nameValuePair;
    readAgentPrompt = name: builtins.readFile (./prompts + "/${name}.md");
    renderAgentPrompt = name: replacements: let
      placeholders = builtins.attrNames replacements;
    in
      builtins.replaceStrings placeholders (map (_placeholder: replacements.${_placeholder}) placeholders) (
        readAgentPrompt name
      );

    mkRules = value: paths:
      builtins.listToAttrs (map (p: nameValuePair p value) paths);

    allow = mkRules "allow";
    deny = mkRules "deny";
    ask = mkRules "ask";

    denyAll = deny ["*"];
    allowAll = allow ["*"];
    askAll = ask ["*"];

    merge = a: b: recursiveUpdate a b;

    addRulesToOps = ops: rules: perm:
      builtins.foldl' (
        acc: op:
          acc // {${op} = (acc.${op} or {}) // rules;}
      )
      perm
      ops;

    addExternalDirs = dirs: perm:
      merge perm {external_directory = allow dirs;};

    scopes = {
      plans = {
        dirs = [".agents/plans"];
        files = [".agents/plans/*.md"];
      };
      draftPlans = {
        dirs = [".agents/plans/draft"];
        files = [".agents/plans/draft/*.md"];
      };
      reports = {
        dirs = [".agents/reports"];
        files = [".agents/reports/*.md"];
      };
      research = {
        dirs = [".agents/research"];
        files = [".agents/research/*.md"];
      };
    };

    withScope = {
      name,
      ops,
    }: perm:
      addExternalDirs scopes.${name}.dirs (
        addRulesToOps ops (allow scopes.${name}.files) perm
      );

    readOnlyPermission = {
      edit = denyAll;
      write = denyAll;
    };

    fullAccessPermission = {
      edit = allowAll;
      write = allowAll;
    };

    tempWorkspacePermission = let
      externalDirPermission = addExternalDirs ["/tmp/*" "/private/tmp/*" "/nix/store/*"] {};
      readablePermission = addRulesToOps ["read"] (allow ["/tmp/*" "/private/tmp/*" "/nix/store" "/nix/store/*"]) externalDirPermission;
    in
      merge readablePermission {
        edit = denyAll // allow ["/tmp/**" "/private/tmp/**"];
        write = denyAll // allow ["/tmp/**" "/private/tmp/**"];
      };

    plansOnlyPermission =
      withScope {
        name = "plans";
        ops = ["edit" "write"];
      }
      readOnlyPermission;

    specPlansPermission = addExternalDirs scopes.draftPlans.dirs (
      addRulesToOps ["read"] (allow scopes.draftPlans.files) plansOnlyPermission
    );

    tempWorkspaceWithReportsPermission =
      withScope {
        name = "reports";
        ops = ["read" "edit" "write"];
      }
      tempWorkspacePermission;

    testSpecFormatContract = ''
      `test-spec` output format (strict, exact):

      # Test Spec: <title>

      ## Summary
      - **Target**: <module or function under test>
      - **Type**: new | modification | both
      - **Behavior**: <one-line description of behavior being tested>
      - **Framework**: <test framework and relevant utilities>
      - **Run command**: `<exact command to run these tests>`

      ## Existing Test Context
      <!-- omit section entirely if Type is "new" -->
      - **File**: <path to existing test file>
      - **What changes**: <one-line: what about existing tests needs to change and why>

      ## Test Matrix

      | ID | Category | Input / Condition | Expected Outcome |
      |----|----------|-------------------|------------------|
      | 1  | happy    | ...               | ...              |
      | 2  | edge     | ...               | ...              |
      | 3  | error    | ...               | ...              |

      ## Setup
      - **Fixtures**: <list with one-line description each>
      - **Mocks**: <what to mock and why, one-line each>
      - **Environment**: <env vars, config, or preconditions>

      ## Constraints
      - <hard constraint, one per line>

      ## Pass/Fail Criteria
      - <criterion, one per line>
    '';

    bugReportFormatContract = ''
      `bug-report` output format (strict, exact):

      # Bug Report: <title>

      ## Summary
      - **Symptom**: <one-line observed behavior>
      - **Expected**: <one-line expected behavior>
      - **Root cause**: <one-line hypothesis with confidence: confirmed | probable | uncertain>
      - **Fix direction**: <one-line recommended approach>
      - **Affected files**: <comma-separated paths>

      ## Reproduction
      1. <step>
      2. <step>
      - **Minimal command**: `<single command that triggers the bug>`

      ## Root Cause Analysis
      - **Entry point**: <file:line where the fault originates>
      - **Mechanism**: <2-3 sentences max: what goes wrong and why>
      - **Impact radius**: <what else could break - list affected callers/dependents>

      ## Fix Specification
      - **Target files**: <path - one per line>
      - **What to change**: <one-line per file: specific change needed>
      - **What NOT to change**: <guard rails - one per line>
      - **Regression check**: `<command to verify fix>`

      ## Unknowns
      - <anything unverified, one per line - empty section if none>
    '';

    reportFilenamePolicy = ''
      Filename policy (strict):
      - Create a NEW timestamped file:
        `.agents/reports/YYYYMMDD-HHMM-<kebab-task-slug>.md`
      - Never overwrite existing files.
      - If collision occurs, append `-v2`, `-v3`, etc.
    '';

    testSpecFilenamePolicy = ''
      Filename policy (strict):
      - Create a NEW timestamped file:
        `.agents/plans/YYYYMMDD-HHMM-<kebab-task-slug>.md`
      - Never overwrite existing files.
      - If collision occurs, append `-v2`, `-v3`, etc.
    '';

    dividableTaskStructure = ''
      Required task-dividable structure:
      - Include a "Task Breakdown" section with task IDs (`T1`, `T2`, ...).
      - For each task include:
        - target file(s) to edit
        - what to change in each target file
        - documentation update targets (required: list affected doc files such as `CLAUDE.md`, `README*`, or doc comments; use `none` if no update is needed)
        - files to refer (optional) and why they are needed
        - task dependency graph/prerequisites (optional)
        - completion criteria
      - Headings may vary, but all fields are mandatory per task.
    '';

    noCommandPermission = {
      bash = "deny";
    };

    boundedEditPermission = fullAccessPermission // noCommandPermission;

    draftPlansOnlyPermission =
      withScope {
        name = "draftPlans";
        ops = ["edit" "write"];
      }
      readOnlyPermission;

    researchOnlyPermission =
      withScope {
        name = "research";
        ops = ["edit" "write"];
      }
      readOnlyPermission;

    reportsOnlyPermission =
      withScope {
        name = "reports";
        ops = ["edit" "write"];
      }
      readOnlyPermission;

    failureReportFormatContract = ''
      `failure-report` output format (strict, exact):

      # Failure Report: <title>

      ## Summary
      - **Scope**: <what was run - command and test scope>
      - **Result**: <X passed, Y failed, Z skipped>
      - **Classification**: regression | flaky | test-bug | env-issue | unknown
      - **Likely owner**: implementation | test-code | infrastructure

      ## Failures

      ### <test identifier>
      - **Error**: <one-line error message or assertion failure>
      - **Stack**: <file:line of innermost relevant frame>
      - **Repro**: `<minimal command to reproduce this single failure>`
      - **Flaky check**: deterministic | flaky (<N/M passes on re-run>)

      ### <test identifier>
      ...

      ## Evidence
      - **Commands run**: <numbered list of commands and their exit codes>
      - **Environment**: <OS, runtime version, relevant config>

      ## Recommended Next Step
      - <one specific action, e.g. "fix assertion in X" or "investigate regression in Y">
    '';

    draftFilenamePolicy = ''
      Filename policy (strict):
      - Create a NEW timestamped file:
        `.agents/plans/draft/YYYYMMDD-HHMM-<kebab-task-slug>.draft.md`
      - Never overwrite existing files.
      - If collision occurs, append `-v2`, `-v3`, etc.
    '';

    researchFilenamePolicy = ''
      Filename policy (strict):
      - Create a NEW timestamped file:
        `.agents/research/YYYYMMDD-HHMM-<kebab-task-slug>.md`
      - Never overwrite existing files.
      - If collision occurs, append `-v2`, `-v3`, etc.
    '';

    draftFailureProtocol = ''
      Failure protocol:
      - If write fails, return:
        - Write status: failed
        - attempted path
        - exact error
      - Do not fall back to chat-only plan text.
    '';
  in {
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
      context = ''

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

    programs.opencode.settings.agent = {
      orchestrator = {
        mode = "primary";
        description = "Primary implementation orchestrator that delegates exploration and edits to specialized subagents.";
        model = "zai-coding-plan/glm-5-turbo";
        prompt = readAgentPrompt "orchestrator";
        permission = merge readOnlyPermission {
          edit = askAll;
          write = askAll;
          bash = "ask";
        };
      };

      idea = {
        mode = "primary";
        description = "Primary ideation agent for early-stage exploration and problem framing before planning; hand off to `spec` by switching agents with the same chat history.";
        model = "github-copilot/claude-opus-4.5";
        prompt = readAgentPrompt "idea";
        permission = readOnlyPermission // {question = "allow";};
      };

      spec = {
        mode = "primary";
        description = "Primary planning agent that handles both ambiguous and well-scoped requests through iterative specification elicitation and systematic planning workflow.";
        model = "openai/gpt-5.4";
        reasoningEffort = "high";
        prompt = renderAgentPrompt "spec" {
          "{{DIVIDABLE_TASK_STRUCTURE}}" = dividableTaskStructure;
        };
        permission = specPlansPermission // {question = "allow";};
      };

      respec = {
        mode = "primary";
        description = "Primary reverse-specification agent that infers existing behavior from code, validates it with the user, and tells the user when to switch agents manually.";
        model = "openai/gpt-5.4";
        reasoningEffort = "high";
        prompt = readAgentPrompt "respec";
        permission = readOnlyPermission // {question = "allow";};
      };

      build = {
        description = "Primary build/validation agent with proactive best-effort delegation to testing and debugging subagents.";
        prompt = readAgentPrompt "build";
        permission = fullAccessPermission;
      };

      debugger = {
        mode = "all";
        model = "openai/gpt-5.4";
        reasoningEffort = "high";
        description = "Performs command-driven bug investigation with reproduction, root-cause analysis, and evidence-only reporting.";
        prompt = renderAgentPrompt "debugger" {
          "{{BUG_REPORT_FORMAT_CONTRACT}}" = bugReportFormatContract;
          "{{REPORT_FILENAME_POLICY}}" = reportFilenamePolicy;
        };
        permission = tempWorkspaceWithReportsPermission;
      };

      test_designer = {
        mode = "all";
        model = "zai-coding-plan/glm-5.1";
        description = "Creates decision-complete test-spec files for zero-context implementation/testing agents, then gates them through plan_reviewer.";
        reasoningEffort = "high";
        prompt = renderAgentPrompt "test_designer" {
          "{{TEST_SPEC_FORMAT_CONTRACT}}" = testSpecFormatContract;
          "{{TEST_SPEC_FILENAME_POLICY}}" = testSpecFilenamePolicy;
        };
        permission = plansOnlyPermission;
      };
      draft_planner = {
        mode = "subagent";
        model = "github-copilot/gpt-5.4-mini";
        description = "Creates direction-setting draft plan files for user approval before detailed final planning.";
        prompt = renderAgentPrompt "draft_planner" {
          "{{DRAFT_FILENAME_POLICY}}" = draftFilenamePolicy;
          "{{DRAFT_FAILURE_PROTOCOL}}" = draftFailureProtocol;
        };
        permission = draftPlansOnlyPermission;
      };

      editor = {
        mode = "subagent";
        model = "zai-coding-plan/glm-5-turbo";
        description = "Instruction-following editor subagent for bounded file edits with minimal required context reads.";
        prompt = readAgentPrompt "editor";
        permission = boundedEditPermission;
      };

      general = {
        mode = "subagent";
        model = "zai-coding-plan/glm-5.1";
        description = "General implementation subagent for delegated file edits plus targeted path exploration.";
        prompt = readAgentPrompt "general";
        permission = boundedEditPermission;
      };

      explore = {
        model = "github-copilot/gpt-5.4-mini";
        reasoningEffort = "high";
        description = "Read-only exploration agent that uses relevant skills provided by primary-agent delegation context.";
        prompt = readAgentPrompt "explore";
        permission = readOnlyPermission;
      };

      plan_reviewer = {
        mode = "subagent";
        model = "openai/gpt-5.4";
        description = "Performs strict read-only review of final plan and test-spec files (`*.md`) with actionable revisions.";
        reasoningEffort = "high";
        prompt = readAgentPrompt "plan_reviewer";
        permission = readOnlyPermission;
      };

      code_reviewer = {
        mode = "subagent";
        model = "openai/gpt-5.4";
        description = "Performs strict read-only code review with severity-ordered findings and concrete file/line evidence.";
        reasoningEffort = "high";
        prompt = readAgentPrompt "code_reviewer";
        permission = readOnlyPermission;
      };

      internet_research = {
        mode = "subagent";
        model = "github-copilot/gpt-5.4-mini";
        reasoningEffort = "high";
        description = "Performs targeted internet research when primary planning agents have material knowledge uncertainty.";
        prompt = renderAgentPrompt "internet_research" {
          "{{RESEARCH_FILENAME_POLICY}}" = researchFilenamePolicy;
        };
        permission = researchOnlyPermission;
      };

      tester = {
        mode = "subagent";
        model = "github-copilot/gpt-5.4-mini";
        description = "Read-only test runner that triages failures and writes failure-report files when suites fail.";
        prompt = renderAgentPrompt "tester" {
          "{{FAILURE_REPORT_FORMAT_CONTRACT}}" = failureReportFormatContract;
          "{{REPORT_FILENAME_POLICY}}" = reportFilenamePolicy;
        };
        permission = merge tempWorkspaceWithReportsPermission {
          edit = askAll;
          write = askAll;
        };
      };
    };
  };

  # Default MCP server membership for OpenCode.
  myconfig.ifEnabled.programs.mcp-servers-nix.targets.opencode = [
    "brave-search"
    "deepwiki"
    "readability"
    "context7"
  ];
}
