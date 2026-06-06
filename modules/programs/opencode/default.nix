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

  options = with delib;
    moduleOptions {
      enable = boolOption host.devCoreFeatured;
      commandExecutionMode = enumOption ["restricted" "full"] "restricted";
    };

  home.ifEnabled = {myconfig, ...}: let
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

    merge = a: b: recursiveUpdate a b;
    mergeMany = builtins.foldl' merge {};
    denyShellOperatorsFor = prefixes:
      builtins.concatMap (prefix: [
        "${prefix}?*&&*"
        "${prefix}?*>*"
        "${prefix}?*|*"
        "${prefix}?*;*"
      ])
      prefixes;

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
      specs = {
        dirs = [".agents/specs"];
        files = [".agents/specs/*.md"];
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
      read = {
        workspace =
          addRulesToOps ["read" "glob" "grep" "list" "lsp"] allowAll {};
      };

      write = {
        none = {
          "edit*" = denyAll;
        };

        full = {
          "edit*" = allowAll;
        };

        tempWorkspace = let
          tempDirs = [
            "/tmp/*"
            "/private/tmp/*"
            "/nix/store"
            "/nix/store/*"
          ];
          tempFiles = [
            "/tmp/*"
            "/tmp/**"
            "/private/tmp/*"
            "/private/tmp/**"
            "/nix/store"
            "/nix/store/*"
          ];
        in
          mergeMany [
            (grantExternalDirs tempDirs {})
            (addRulesToOps ["read"] (allow tempFiles) {})
            {
              "edit*" = denyAll // allow ["/tmp/**" "/private/tmp/**"];
            }
          ];
      };

      execute = {
        none = {
          bash = "deny";
        };

        agentsDirectoryCreation = {
          bash =
            denyAll
            // allow [
              "mkdir .agents"
              "mkdir .agents/*"
              "mkdir .agents/**"
              "mkdir -p .agents"
              "mkdir -p .agents/*"
              "mkdir -p .agents/**"
            ]
            // deny (denyShellOperatorsFor ["mkdir"]);
        };

        agentsDateFetch = {
          bash =
            denyAll
            // allow [
              "date +%Y%m%d-%H%M"
            ]
            // deny (denyShellOperatorsFor ["date"]);
        };

        testAndDebug = let
          commandPrefixes = [
            "just"
            "nix"
            "nh"
            "deno"
            "uv"
            "npm"
            "pnpm"
            "bun"
            "python"
            "make"
          ];
          unsafeCommandPatterns = [
            "just?*apply*"
            "just?*clean*"
            "just?*fmt*"
            "just?*home*"
            "just?*switch*"
            "just?*update*"
            "nix?*fmt*"
            "nix?*flake?*lock*"
            "nix?*flake?*update*"
            "nix?*--update-input*"
            "npm?*install*"
            "npm?*publish*"
            "npm?*version*"
            "pnpm?*add*"
            "pnpm?*install*"
            "pnpm?*publish*"
            "pnpm?*remove*"
            "pnpm?*version*"
            "bun?*add*"
            "bun?*install*"
            "bun?*publish*"
            "bun?*remove*"
            "bun?*x*"
            "deno?*install*"
            "uv?*add*"
            "uv?*lock*"
            "uv?*remove*"
            "uv?*sync*"
            "python?*-c*"
            "make?*clean*"
          ];
        in {
          bash =
            denyAll
            // allow (map (prefix: "${prefix}*") commandPrefixes)
            // deny (denyShellOperatorsFor commandPrefixes ++ unsafeCommandPatterns);
        };

        full = {
          bash = "allow";
        };

        # OpenCode evaluates granular permission rules with the last matching
        # pattern winning. The deny patterns use `git?*` instead of `git *` so
        # Nix's sorted attrset keys place them after the broad `git <cmd>*` ask
        # rules while still matching the separating space after `git`.
        safeGitInspection = {
          bash =
            denyAll
            // allow [
              "git diff*"
              "git branch --show-current*"
              "git ls-remote*"
              "git ls-files*"
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

        safeValidation = {
          bash =
            denyAll
            // allow [
              "git diff --check*"
              "nix flake check --no-build*"
              "nix flake show*"
              "nix-instantiate --parse*"
            ]
            // deny [
              "git?*&&*"
              "git?*>*"
              "git?*|*"
              "git?*;*"
              "nix?*&&*"
              "nix?*>*"
              "nix?*|*"
              "nix?*;*"
              "nix-instantiate?*&&*"
              "nix-instantiate?*>*"
              "nix-instantiate?*|*"
              "nix-instantiate?*;*"
            ];
        };

        ghReviewInspection = {
          bash =
            denyAll
            // allow [
              "gh auth status*"
              "gh issue view*"
              "gh pr diff*"
              "gh pr list*"
              "gh pr view*"
              "gh repo view*"
              "gh api repos/*/issues/*"
              "gh api repos/*/issues/*/comments*"
              "gh api repos/*/pulls/*"
              "gh api repos/*/pulls/*/comments*"
              "gh api repos/*/pulls/*/reviews*"
            ]
            // deny [
              "gh?*&&*"
              "gh?*>*"
              "gh?*|*"
              "gh?*;*"
              "gh?*--field*"
              "gh?*--input*"
              "gh?*--method*"
              "gh?*--raw-field*"
              "gh?*-F*"
              "gh?*-X*"
              "gh?*-f*"
            ];
        };
      };

      delegate = {
        none = {
          task = denyAll;
        };

        all = {
          task = allowAll;
        };

        only = agents: {
          task = denyAll // allow agents;
        };

        # Same order-sensitive OpenCode rule model as `bash.safeGitInspection`:
        # deny delegation broadly, then allow the dedicated read-only explorer.
        exploreOnly = {
          task = denyAll // allow ["explore"];
        };
      };

      interact = {
        none = {
          question = "deny";
          todowrite = "deny";
        };

        question = {
          question = "allow";
        };

        todo = {
          todowrite = "allow";
        };

        all = {
          question = "allow";
          todowrite = "allow";
        };
      };

      network = {
        none = {
          webfetch = "deny";
          websearch = "deny";
          repo_clone = denyAll;
          repo_overview = denyAll;
        };

        web = {
          webfetch = "allow";
          websearch = "allow";
        };

        full = {
          webfetch = "allow";
          websearch = "allow";
          repo_clone = allowAll;
          repo_overview = allowAll;
        };
      };

      context = {
        none = {
          skill = denyAll;
        };

        full = {
          skill = allowAll;
        };
      };

      safety = {
        externalAll = {
          external_directory = allowAll;
        };
      };

      scope = {
        plans = ops: base:
          grantScope {
            name = "plans";
            inherit ops;
          }
          base;

        specs = ops: base:
          grantScope {
            name = "specs";
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
      pureRead = mergeMany [
        perm.read.workspace
        perm.write.none
        perm.execute.none
        perm.execute.agentsDirectoryCreation
        perm.execute.agentsDateFetch
        perm.delegate.none
        perm.interact.none
        perm.network.none
        perm.context.none
      ];

      agentsOnly = perm.scope.agents ["read" "edit*"] pureRead;

      composedFull = mergeMany [
        perm.read.workspace
        perm.write.full
        perm.execute.full
        perm.delegate.all
        perm.interact.all
        perm.network.full
        perm.context.full
        perm.safety.externalAll
      ];

      unrestrictedCommandReadWrite = mergeMany [
        perm.read.workspace
        perm.write.full
        perm.execute.full
        perm.safety.externalAll
      ];

      tempWorkspaceWithReports =
        perm.scope.reports ["read" "edit*"]
        (mergeMany [
          pureRead
          perm.write.tempWorkspace
        ]);

      safeEvidenceCollection = mergeMany [
        perm.execute.testAndDebug
        perm.execute.safeGitInspection
      ];

      scoutFull = mergeMany [
        agentsOnly
        perm.write.tempWorkspace
        safeEvidenceCollection
        perm.execute.ghReviewInspection
        perm.interact.question
        perm.context.full
        (perm.delegate.only [
          "explore"
          "researcher"
          "challenger"
          "taskmaster"
          "plan_reviewer"
          "inspector"
          "reviewer1"
          "reviewer2"
          "tester"
        ])
      ];

      debugSandbox = mergeMany [
        tempWorkspaceWithReports
        safeEvidenceCollection
        perm.interact.question
        perm.delegate.exploreOnly
      ];

      testRunner = mergeMany [
        tempWorkspaceWithReports
        perm.execute.safeGitInspection
        perm.execute.safeValidation
      ];

      readOnlyGitInspection = mergeMany [
        pureRead
        perm.execute.safeGitInspection
        perm.interact.question
      ];

      challenger = mergeMany [
        pureRead
        perm.execute.safeGitInspection
        perm.context.full
        (perm.delegate.only [
          "explore"
          "researcher"
        ])
      ];

      researchOnly = perm.scope.research ["edit*"] pureRead;

      networkResearch = mergeMany [
        researchOnly
        perm.network.web
      ];

      reportsOnly = perm.scope.reports ["edit*"] pureRead;

      inspector = mergeMany [
        reportsOnly
        perm.execute.safeGitInspection
        perm.execute.ghReviewInspection
        perm.interact.question
        perm.context.full
        (perm.delegate.only [
          "explore"
          "researcher"
          "reviewer1"
          "reviewer2"
          "pruner"
          "tester"
        ])
      ];
    };

    applyCommandExecutionMode = base:
      if myconfig.programs.opencode.commandExecutionMode == "full"
      then merge base perm.execute.full
      else base;

    testSpecFormatContract = readSharedPrompt "test-spec-format";
    bugReportFormatContract = readSharedPrompt "bug-report-format";
    reportFilenamePolicy = readSharedPrompt "report-filename-policy";
    reviewReportFormatContract = readSharedPrompt "review-report-format";
    implementationReportFormatContract = readSharedPrompt "implementation-report-format";
    planFilenamePolicy = readSharedPrompt "test-spec-filename-policy";
    dividableTaskStructure = readSharedPrompt "task-breakdown-structure";
    failureReportFormatContract = readSharedPrompt "failure-report-format";
    specFilenamePolicy = readSharedPrompt "spec-filename-policy";
    researchFilenamePolicy = readSharedPrompt "research-filename-policy";
    secretPath = name: sopsSecretPaths.${name} or "/run/secrets/${name}";
    reviewCommandTemplate = ''
      ${builtins.readFile ./prompts/commands/review.md}
      ${reviewReportFormatContract}

      Enforcement rules:
      - The report must start with `# Review Report: <title>` followed by `## Summary`.
      - Every finding must include concrete evidence or explicitly say `Evidence: not confirmed` with a reason.
      - Every finding must include `Diff provenance` confirming how the issue relates to the reviewed diff or stating why diff provenance could not be established for a non-diff target.
      - `## Perspective Results` must include every perspective attempted and every perspective intentionally skipped.
      - `## Recommended Next Step` must contain exactly one concrete action.

      ${reportFilenamePolicy}
    '';
    debugCommandTemplate = ''
      ${builtins.readFile ./prompts/commands/debug.md}
      ${bugReportFormatContract}

      ${reportFilenamePolicy}
    '';
    specCommandTemplate = builtins.replaceStrings ["{{DIVIDABLE_TASK_STRUCTURE}}" "{{SPEC_FILENAME_POLICY}}" "{{PLAN_FILENAME_POLICY}}"] [dividableTaskStructure specFilenamePolicy planFilenamePolicy] (
      builtins.readFile ./prompts/commands/spec.md
    );
    actCommandTemplate = renderAgentPrompt "commands/act" {
      "{{PLAN_FILENAME_POLICY}}" = planFilenamePolicy;
    };
    implCommandTemplate = renderAgentPrompt "commands/impl" {
      "{{IMPLEMENTATION_REPORT_FORMAT_CONTRACT}}" = implementationReportFormatContract;
      "{{REPORT_FILENAME_POLICY}}" = reportFilenamePolicy;
    };
  in {
    programs.opencode = {
      enable = true;
      package = llm-agents.opencode;
      settings = {
        lsp = true;
        command = {
          spec = {
            template = specCommandTemplate;
            description = "Plan a target with scout using the specification workflow.";
            agent = "scout";
            subtask = false;
          };
          sensei = {
            template = builtins.readFile ./prompts/commands/sensei.md;
            description = "Explain reports, files, commits, or git ranges with calibrated teaching.";
            agent = "scout";
            subtask = false;
          };
          idea = {
            template = builtins.readFile ./prompts/commands/idea.md;
            description = "Explore rough ideas conversationally before planning.";
            agent = "scout";
            model = "opencode/deepseek-v4-flash-free";
            subtask = false;
          };
          act = {
            template = actCommandTemplate;
            description = "Plan, approve, and implement a small task with taskmaster.";
            agent = "taskmaster";
            subtask = false;
          };
          impl = {
            template = implCommandTemplate;
            description = "Implement a plan or target with taskmaster using the implementation workflow.";
            agent = "taskmaster";
            subtask = false;
          };
          debug = {
            template = debugCommandTemplate;
            description = "Investigate a bug with inspector using the debug skill.";
            agent = "inspector";
            subtask = false;
          };
          review = {
            template = reviewCommandTemplate;
            description = "Review a target with inspector using the review skill.";
            agent = "inspector";
            subtask = true;
          };
          primary-review = {
            template = reviewCommandTemplate;
            description = "Review a target with inspector using the review skill.";
            agent = "inspector";
            subtask = false;
          };
        };
        share = "disabled";
        autoupdate = false;
        default_agent = "scout";
        experimental = {
          mcp_timeout = 1200000;
        };
        plugin = [];
        provider = {
          openrouter = {
            options = {
              apiKey = "{file:${secretPath "openrouter-api-key"}}";
            };
          };
          ollama = {
            npm = "@ai-sdk/openai-compatible";
            name = "Ollama";
            options = {
              baseURL = "http://127.0.0.1:11434/v1";
            };
            models = {
              "gemma4:e4b" = {
                name = "Gemma 4 E4B";
                limit = {
                  context = 32768;
                  output = 8192;
                };
              };

              # "qwen3.5:9b" = {
              #   name = "Qwen 3.5 9B";
              #   limit = {
              #     context = 32768;
              #     output = 8192;
              #   };
              # };
            };
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

      taskmaster = {
        mode = "all";
        model = "openai/gpt-5.5";
        reasoningEffort = "medium";
        description = "Source-changing implementation agent shaped by the received request or command contract.";
        prompt = renderAgentPrompt "taskmaster" {
          "{{IMPLEMENTATION_REPORT_FORMAT_CONTRACT}}" = implementationReportFormatContract;
          "{{REPORT_FILENAME_POLICY}}" = reportFilenamePolicy;
        };
        permission = applyCommandExecutionMode agentPerm.composedFull;
      };

      ultra-ai-xhigh-pro-max = {
        mode = "all";
        model = "openai/gpt-5.5";
        reasoningEffort = "high";
        description = "Primary agent with unrestricted external command execution plus read/write access.";
        prompt = ''
          You are the `ultra-ai-xhigh-pro-max` agent.

          You may execute external commands without OpenCode permission restrictions and may read/write files as requested.
          Follow the user's concrete request and report concisely.
        '';
        permission = applyCommandExecutionMode agentPerm.unrestrictedCommandReadWrite;
      };

      scout = {
        mode = "all";
        model = "openai/gpt-5.5";
        reasoningEffort = "medium";
        description = "Non-source-writing agent for planning, inspection, and report workflows.";
        prompt = readAgentPrompt "scout";
        permission = applyCommandExecutionMode agentPerm.scoutFull;
      };

      eyes = {
        mode = "all";
        model = "ollama/gemma4:e4b";
        description = "Read-only observer for quick codebase inspection.";
        prompt = ''
          You are Eyes, a read-only observation agent.

          Goal:
          Inspect the requested files, diffs, logs, or repository area and report what is visible.

          Rules:
          - Do not edit files.
          - Do not propose broad redesigns unless asked.
          - Do not run destructive commands.
          - Prefer concrete findings over speculation.
          - Mention uncertainty when evidence is insufficient.
          - Keep the report short.

          Output:
          - Summary
          - Findings
          - Risks or unknowns
          - Suggested next action, only if obvious
        '';
        permission = applyCommandExecutionMode agentPerm.pureRead;
      };
      inspector = {
        mode = "all";
        model = "openai/gpt-5.5";
        reasoningEffort = "high";
        description = "Shared review/debug orchestration entrypoint with skill-led read-only inspection.";
        prompt = readAgentPrompt "inspector";
        permission = applyCommandExecutionMode agentPerm.inspector;
      };

      explore = {
        # model = "openrouter/poolside/laguna-xs.2:free";
        model = "openai/gpt-5.4-mini";
        reasoningEffort = "medium";
        description = "Read-only exploration agent for delegated repository and filesystem context gathering.";
        prompt = readAgentPrompt "explore";
        permission = applyCommandExecutionMode (mergeMany [
          agentPerm.pureRead
          perm.execute.safeGitInspection
        ]);
      };

      plan_reviewer = {
        mode = "subagent";
        model = "openai/gpt-5.5";
        description = "Reviews final plan steps against the referenced spec for feasibility and correctness.";
        reasoningEffort = "low";
        prompt = readAgentPrompt "plan_reviewer";
        permission = applyCommandExecutionMode (merge agentPerm.pureRead perm.context.full);
      };

      challenger = {
        mode = "subagent";
        model = "openai/gpt-5.5";
        description = "Challenges request/spec framing and assumptions with calibrated evidence checks.";
        reasoningEffort = "medium";
        prompt = readAgentPrompt "challenger";
        permission = applyCommandExecutionMode agentPerm.challenger;
      };

      reviewer1 = {
        mode = "subagent";
        model = "openai/gpt-5.5";
        description = "Performs strict read-only code review with severity-ordered findings and concrete file/line evidence.";
        reasoningEffort = "medium";
        prompt = readAgentPrompt "strict_reviewer";
        permission = applyCommandExecutionMode (mergeMany [
          agentPerm.pureRead
          perm.execute.safeGitInspection
          perm.context.full
        ]);
      };

      reviewer2 = {
        mode = "subagent";
        model = "opencode/nemotron-3-ultra-free";
        description = "Performs strict read-only code review with severity-ordered findings and concrete file/line evidence.";
        reasoningEffort = "medium";
        prompt = readAgentPrompt "strict_reviewer";
        permission = applyCommandExecutionMode (mergeMany [
          agentPerm.pureRead
          perm.execute.safeGitInspection
          perm.context.full
        ]);
      };

      pruner = {
        mode = "subagent";
        model = "openai/gpt-5.4-mini";
        description = "Finds commonization opportunities, dead code, and stale implementation residue with concrete evidence.";
        reasoningEffort = "medium";
        prompt = readAgentPrompt "pruner";
        permission = applyCommandExecutionMode (mergeMany [
          agentPerm.pureRead
          perm.execute.safeGitInspection
          perm.context.full
        ]);
      };

      researcher = {
        mode = "subagent";
        model = "github-copilot/gpt-5.4-mini";
        reasoningEffort = "high";
        description = "Performs targeted internet research when planning workflows have material knowledge uncertainty.";
        prompt = renderAgentPrompt "researcher" {
          "{{RESEARCH_FILENAME_POLICY}}" = researchFilenamePolicy;
        };
        permission = applyCommandExecutionMode agentPerm.networkResearch;
      };

      tester = {
        mode = "subagent";
        model = "opencode/deepseek-v4-flash-free";
        reasoningEffort = "medium";
        description = "Read-only test runner that triages failures and writes failure-report files when suites fail.";
        prompt = renderAgentPrompt "tester" {
          "{{FAILURE_REPORT_FORMAT_CONTRACT}}" = failureReportFormatContract;
          "{{REPORT_FILENAME_POLICY}}" = reportFilenamePolicy;
        };
        permission = applyCommandExecutionMode agentPerm.testRunner;
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
