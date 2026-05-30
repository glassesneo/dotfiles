{
  delib,
  host,
  lib,
  llm-agents,
  ...
}:
delib.module {
  name = "programs.opencode";

  options = delib.singleEnableOption host.devCoreFeatured;

  home.ifEnabled = let
    inherit (lib.attrsets) recursiveUpdate;
    inherit (lib.attrsets) nameValuePair;
    readAgentPrompt = name: builtins.readFile (./prompts + "/${name}.md");
    readSharedPrompt = name: builtins.readFile (./prompts/shared + "/${name}.md");
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

    taskDelegationPermissionForSubagent =
      denyAll
      // {
        "explore" = "allow";
      };

    readOnlyPermission = {
      edit = denyAll;
      write = denyAll;
      task = allowAll;
    };

    fullAccessPermission = {
      edit = allowAll;
      write = allowAll;
      task = allowAll;
    };

    tempWorkspacePermission = let
      externalDirPermission = addExternalDirs ["/tmp/*" "/private/tmp/*" "/nix/store/*"] {};
      readablePermission = addRulesToOps ["read"] (allow ["/tmp/*" "/private/tmp/*" "/nix/store" "/nix/store/*"]) externalDirPermission;
    in
      merge readablePermission {
        edit = denyAll // allow ["/tmp/**" "/private/tmp/**"];
        write = denyAll // allow ["/tmp/**" "/private/tmp/**"];
        task = allowAll;
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

    testSpecFormatContract = readSharedPrompt "test-spec-format";
    bugReportFormatContract = readSharedPrompt "bug-report-format";
    reportFilenamePolicy = readSharedPrompt "report-filename-policy";
    reviewReportFormatContract = readSharedPrompt "review-report-format";
    testSpecFilenamePolicy = readSharedPrompt "test-spec-filename-policy";
    dividableTaskStructure = readSharedPrompt "task-breakdown-structure";

    noCommandPermission = {
      bash = "deny";
    };

    boundedEditPermission = fullAccessPermission // noCommandPermission;

    readOnlyGitInspectionPermission =
      readOnlyPermission
      // {
        bash =
          denyAll
          // ask [
            "git diff*"
            "git log*"
            "git merge-base*"
            "git rev-list*"
            "git rev-parse*"
            "git show*"
            "git status*"
          ]
          // deny [
            "git *&&*"
            "git *>*"
            "git *|*"
            "git *;*"
            "git *--output*"
          ];
        question = "allow";
      };

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

    failureReportFormatContract = readSharedPrompt "failure-report-format";
    draftFilenamePolicy = readSharedPrompt "draft-filename-policy";
    researchFilenamePolicy = readSharedPrompt "research-filename-policy";
    draftFailureProtocol = readSharedPrompt "draft-failure-protocol";
  in {
    programs.opencode = {
      enable = true;
      package = llm-agents.opencode;
      settings = {
        lsp = true;
        command = {
          spec = {
            template = ''
              Spec target: $ARGUMENTS
            '';
            description = "Plan a target with the spec agent.";
            agent = "spec";
            subtask = false;
          };
          impl = {
            template = ''
              Implement: $ARGUMENTS
            '';
            description = "Implement a plan with the implementer agent.";
            agent = "implementer";
            subtask = false;
          };
          review = {
            template = ''
              Review target: $ARGUMENTS
            '';
            agent = "reviewer";
            subtask = true;
          };
          primary-review = {
            template = ''
              Review target: $ARGUMENTS
            '';
            agent = "reviewer";
            subtask = false;
          };
        };
        share = "disabled";
        autoupdate = false;
        default_agent = "spec";
        experimental = {
          mcp_timeout = 1200000;
        };
        plugin = [];
      };
      context = readSharedPrompt "opencode-context";
    };

    programs.opencode.settings.agent = {
      plan.disable = true;
      build.disable = true;
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
        model = "openai/gpt-5.5";
        reasoningEffort = "high";
        prompt = renderAgentPrompt "spec" {
          "{{DIVIDABLE_TASK_STRUCTURE}}" = dividableTaskStructure;
        };
        permission = specPlansPermission // {question = "allow";};
      };

      implementer = {
        mode = "primary";
        model = "openai/gpt-5.5";
        reasoningEffort = "medium";
        description = "Primary implementation and validation agent with proactive best-effort delegation to testing and debugging subagents.";
        prompt = readAgentPrompt "implementer";
        permission = fullAccessPermission;
      };

      sensei = {
        mode = "primary";
        model = "openai/gpt-5.5";
        reasoningEffort = "medium";
        description = "Primary explanation agent that teaches reports and git revisions/ranges to project outsiders after calibrating user understanding.";
        prompt = readAgentPrompt "sensei";
        permission = readOnlyGitInspectionPermission;
      };

      reviewer = {
        mode = "all";
        model = "openai/gpt-5.5";
        reasoningEffort = "high";
        description = "Primary orchestrated reviewer for code written by others, with exploration, optional research, multi-perspective subreviews, and report output.";
        prompt = renderAgentPrompt "reviewer" {
          "{{REVIEW_REPORT_FORMAT_CONTRACT}}" = reviewReportFormatContract;
          "{{REPORT_FILENAME_POLICY}}" = reportFilenamePolicy;
        };
        permission =
          reportsOnlyPermission
          // {
            bash = "allow";
            question = "allow";
          };
      };

      debugger = {
        mode = "all";
        model = "openai/gpt-5.5";
        reasoningEffort = "medium";
        description = "Performs command-driven bug investigation with reproduction, root-cause analysis, and evidence-only reporting.";
        prompt = renderAgentPrompt "debugger" {
          "{{BUG_REPORT_FORMAT_CONTRACT}}" = bugReportFormatContract;
          "{{REPORT_FILENAME_POLICY}}" = reportFilenamePolicy;
        };
        permission = tempWorkspaceWithReportsPermission;
      };

      draft_planner = {
        mode = "subagent";
        model = "github-copilot/gpt-5.4-mini";
        reasoningEffort = "high";
        description = "Creates direction-setting draft plan files for user approval before detailed final planning.";
        prompt = renderAgentPrompt "draft_planner" {
          "{{DRAFT_FILENAME_POLICY}}" = draftFilenamePolicy;
          "{{DRAFT_FAILURE_PROTOCOL}}" = draftFailureProtocol;
        };
        permission = draftPlansOnlyPermission // {task = taskDelegationPermissionForSubagent;};
      };

      explore = {
        model = "github-copilot/gpt-5.4-mini";
        reasoningEffort = "high";
        description = "Read-only exploration agent that uses relevant skills provided by primary-agent delegation context.";
        prompt = readAgentPrompt "explore";
        permission = readOnlyPermission // {task = taskDelegationPermissionForSubagent;};
      };

      plan_reviewer = {
        mode = "subagent";
        model = "openai/gpt-5.5";
        description = "Performs strict read-only review of final plan and test-spec files (`*.md`) with actionable revisions.";
        reasoningEffort = "low";
        prompt = readAgentPrompt "plan_reviewer";
        permission = readOnlyPermission;
      };

      code_reviewer = {
        mode = "subagent";
        model = "openai/gpt-5.5";
        description = "Performs strict read-only code review with severity-ordered findings and concrete file/line evidence.";
        reasoningEffort = "medium";
        prompt = readAgentPrompt "code_reviewer";
        permission = readOnlyPermission // {task = taskDelegationPermissionForSubagent;};
      };

      researcher = {
        mode = "subagent";
        model = "openai/gpt-5.5";
        reasoningEffort = "medium";
        description = "Performs targeted internet research when primary planning agents have material knowledge uncertainty.";
        prompt = renderAgentPrompt "researcher" {
          "{{RESEARCH_FILENAME_POLICY}}" = researchFilenamePolicy;
        };
        permission = researchOnlyPermission;
      };

      tester = {
        mode = "subagent";
        model = "github-copilot/gpt-5.4-mini";
        reasoningEffort = "high";
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
