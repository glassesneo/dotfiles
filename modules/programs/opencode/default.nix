{
  delib,
  host,
  lib,
  llm-agents,
  sopsSecretPaths,
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

    grantExternalDirs = dirs: perm:
      merge perm {external_directory = allow dirs;};

    scopes = {
      agents = {
        dirs = [".agents"];
        files = [".agents/**"];
      };
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

    grantScope = {
      name,
      ops,
    }: perm:
      grantExternalDirs scopes.${name}.dirs (
        addRulesToOps ops (allow scopes.${name}.files) perm
      );

    perm = {
      fs = {
        readOnly = {
          edit = denyAll;
          task = allowAll;
        };

        fullWrite = {
          edit = allowAll;
          task = allowAll;
        };

        tempWorkspace = let
          externalDirPermission = grantExternalDirs [
            "/tmp/*"
            "/private/tmp/*"
            "/nix/store"
            "/nix/store/*"
          ] {};
          readablePermission =
            addRulesToOps ["read"] (allow [
              "/tmp/*"
              "/private/tmp/*"
              "/nix/store"
              "/nix/store/*"
            ])
            externalDirPermission;
        in
          merge readablePermission {
            edit = denyAll // allow ["/tmp/**" "/private/tmp/**"];
            task = allowAll;
          };
      };

      bash = {
        none = {
          bash = "deny";
        };

        # OpenCode evaluates granular permission rules with the last matching
        # pattern winning. The deny patterns use `git?*` instead of `git *` so
        # Nix's sorted attrset keys place them after the broad `git <cmd>*` ask
        # rules while still matching the separating space after `git`.
        safeGitInspection = {
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
              "git?*&&*"
              "git?*>*"
              "git?*|*"
              "git?*;*"
              "git?*--output*"
            ];
        };
      };

      task = {
        # Same order-sensitive OpenCode rule model as `bash.safeGitInspection`:
        # deny delegation broadly, then allow the dedicated read-only explorer.
        delegateExploreOnly = {
          task =
            denyAll
            // {
              "explore" = "allow";
            };
        };
      };

      interaction = {
        question = {
          question = "allow";
        };
      };

      scope = {
        plans = ops: base:
          grantScope {
            name = "plans";
            inherit ops;
          }
          base;

        draftPlans = ops: base:
          grantScope {
            name = "draftPlans";
            inherit ops;
          }
          base;

        reports = ops: base:
          grantScope {
            name = "reports";
            inherit ops;
          }
          base;

        research = ops: base:
          grantScope {
            name = "research";
            inherit ops;
          }
          base;

        agents = ops: base:
          grantScope {
            name = "agents";
            inherit ops;
          }
          base;
      };
    };

    agentPerm = rec {
      plansOnly = perm.scope.plans ["edit"] perm.fs.readOnly;

      specPlans = perm.scope.draftPlans ["read"] plansOnly;

      tempWorkspaceWithReports = perm.scope.reports ["read" "edit"] perm.fs.tempWorkspace;

      agentsOnly = perm.scope.agents ["read" "edit"] perm.fs.readOnly;

      readOnlyGitInspection = merge (merge perm.fs.readOnly perm.bash.safeGitInspection) perm.interaction.question;

      draftPlansOnly = perm.scope.draftPlans ["edit"] perm.fs.readOnly;

      researchOnly = perm.scope.research ["edit"] perm.fs.readOnly;

      reportsOnly = perm.scope.reports ["edit"] perm.fs.readOnly;
    };

    testSpecFormatContract = readSharedPrompt "test-spec-format";
    bugReportFormatContract = readSharedPrompt "bug-report-format";
    reportFilenamePolicy = readSharedPrompt "report-filename-policy";
    reviewReportFormatContract = readSharedPrompt "review-report-format";
    testSpecFilenamePolicy = readSharedPrompt "test-spec-filename-policy";
    dividableTaskStructure = readSharedPrompt "task-breakdown-structure";
    reviewWorkflow = readSharedPrompt "review-workflow";

    failureReportFormatContract = readSharedPrompt "failure-report-format";
    draftFilenamePolicy = readSharedPrompt "draft-filename-policy";
    researchFilenamePolicy = readSharedPrompt "research-filename-policy";
    draftFailureProtocol = readSharedPrompt "draft-failure-protocol";
    secretPath = name: sopsSecretPaths.${name} or "/run/secrets/${name}";
    reviewCommandTemplate = ''
      ${builtins.readFile ./prompts/commands/review.md}
      ${reviewWorkflow}
      ${reviewReportFormatContract}

      Enforcement rules:
      - The report must start with `# Review Report: <title>` followed by `## Summary`.
      - Every finding must include concrete evidence or explicitly say `Evidence: not confirmed` with a reason.
      - Every finding must include `Diff provenance` confirming how the issue relates to the reviewed diff or stating why diff provenance could not be established for a non-diff target.
      - `## Perspective Results` must include every perspective attempted and every perspective intentionally skipped.
      - `## Delegation Log` must list subagents used and concise outcomes.
      - `## Recommended Next Step` must contain exactly one concrete action.

      ${reportFilenamePolicy}
    '';
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
            template = builtins.readFile ./prompts/commands/impl.md;
            description = "Implement a plan or target with taskmaster-write using the implementation workflow.";
            agent = "taskmaster-write";
            subtask = false;
          };
          review = {
            template = reviewCommandTemplate;
            agent = "taskmaster-read";
            subtask = true;
          };
          primary-review = {
            template = reviewCommandTemplate;
            agent = "taskmaster-read";
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
        provider = {
          openrouter = {
            apiKey = "{file:${secretPath "openrouter-api-key"}}";
          };
        };
      };
      context = readSharedPrompt "opencode-context";
      tui = {
        attention = {
          enabled = true;
          notifications = true;
          sound = false;
        };
      };
    };

    programs.opencode.settings.agent = {
      plan.disable = true;
      build.disable = true;
      # idea = {
      #   mode = "primary";
      #   description = "Primary ideation agent for early-stage exploration and problem framing before planning; hand off to `spec` by switching agents with the same chat history.";
      #   model = "github-copilot/claude-opus-4.5";
      #   prompt = readAgentPrompt "idea";
      #   permission = merge perm.fs.readOnly perm.interaction.question;
      # };

      spec = {
        mode = "primary";
        description = "Primary planning agent that handles both ambiguous and well-scoped requests through iterative specification elicitation and systematic planning workflow.";
        model = "openai/gpt-5.5";
        reasoningEffort = "high";
        prompt = renderAgentPrompt "spec" {
          "{{DIVIDABLE_TASK_STRUCTURE}}" = dividableTaskStructure;
        };
        permission = merge agentPerm.specPlans perm.interaction.question;
      };

      taskmaster-write = {
        mode = "all";
        model = "openai/gpt-5.5";
        reasoningEffort = "medium";
        description = "Command-directed implementation agent for source-changing workflows, validation, triage, and post-implementation review delegation.";
        prompt = readAgentPrompt "taskmaster-write";
        permission = merge perm.fs.fullWrite perm.interaction.question;
      };

      taskmaster-read = {
        mode = "all";
        model = "openai/gpt-5.5";
        reasoningEffort = "medium";
        description = "Command-directed read/report agent for review and other source-read-only workflows.";
        prompt = readAgentPrompt "taskmaster-read";
        permission =
          merge
          (merge agentPerm.agentsOnly perm.bash.safeGitInspection)
          perm.interaction.question;
      };

      reviewer = {
        mode = "subagent";
        model = "openai/gpt-5.5";
        reasoningEffort = "high";
        description = "Autonomous review subagent for orchestrated evidence-first code review with report output.";
        prompt = renderAgentPrompt "reviewer" {
          "{{REVIEW_WORKFLOW}}" = reviewWorkflow;
          "{{REVIEW_REPORT_FORMAT_CONTRACT}}" = reviewReportFormatContract;
          "{{REPORT_FILENAME_POLICY}}" = reportFilenamePolicy;
        };
        permission =
          merge
          (merge agentPerm.reportsOnly perm.bash.safeGitInspection)
          perm.interaction.question;
      };

      sensei = {
        mode = "primary";
        model = "openai/gpt-5.5";
        reasoningEffort = "medium";
        description = "Primary explanation agent that teaches reports and git revisions/ranges to project outsiders after calibrating user understanding.";
        prompt = readAgentPrompt "sensei";
        permission = agentPerm.readOnlyGitInspection;
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
        permission = agentPerm.tempWorkspaceWithReports;
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
        permission = agentPerm.draftPlansOnly // perm.task.delegateExploreOnly;
      };

      explore = {
        model = "github-copilot/gpt-5.4-mini";
        reasoningEffort = "high";
        description = "Read-only exploration agent for delegated repository and filesystem context gathering.";
        prompt = readAgentPrompt "explore";
        permission = perm.fs.readOnly // perm.task.delegateExploreOnly;
      };

      plan_reviewer = {
        mode = "subagent";
        model = "openai/gpt-5.5";
        description = "Performs strict read-only review of final plan and test-spec files (`*.md`) with actionable revisions.";
        reasoningEffort = "low";
        prompt = readAgentPrompt "plan_reviewer";
        permission = perm.fs.readOnly;
      };

      code_reviewer = {
        mode = "subagent";
        model = "openai/gpt-5.5";
        description = "Performs strict read-only code review with severity-ordered findings and concrete file/line evidence.";
        reasoningEffort = "medium";
        prompt = readAgentPrompt "code_reviewer";
        permission = perm.fs.readOnly // perm.task.delegateExploreOnly;
      };

      researcher = {
        mode = "subagent";
        model = "openai/gpt-5.5";
        reasoningEffort = "medium";
        description = "Performs targeted internet research when primary planning agents have material knowledge uncertainty.";
        prompt = renderAgentPrompt "researcher" {
          "{{RESEARCH_FILENAME_POLICY}}" = researchFilenamePolicy;
        };
        permission = agentPerm.researchOnly;
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
        permission = merge agentPerm.tempWorkspaceWithReports {
          edit = askAll;
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
