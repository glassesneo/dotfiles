{
  delib,
  lib,
  ...
}:
delib.module {
  name = "programs.opencode";

  myconfig.always.args.shared.opencodeAgentPermissions = let
    inherit (lib.attrsets) recursiveUpdate;
    inherit (lib.attrsets) nameValuePair;

    mkRules = value: paths:
      builtins.listToAttrs (map (p: nameValuePair p value) paths);

    allow = mkRules "allow";
    deny = mkRules "deny";
    ask = mkRules "ask";

    denyAll = deny ["*"];
    allowAll = allow ["*"];
    askAll = ask ["*"];

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

    commandRulesFor = prefixes:
      builtins.concatMap (prefix: [prefix "${prefix} *"]) prefixes;

    askAmbiguousShellEffectsFor = prefixes:
      ask (builtins.concatMap (prefix: [
          "${prefix}?*$(*"
          "${prefix}?*&&*"
          "${prefix}?*<*"
          "${prefix}?*>*"
          "${prefix}?*`*"
          "${prefix}?*|*"
          "${prefix}?*;*"
        ])
        prefixes);

    ghInspectionCommands = [
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
    ];

    ghMutationArgumentPatterns = [
      "gh?*--field*"
      "gh?*--input*"
      "gh?*--method*"
      "gh?*--raw-field*"
      "gh?*-F*"
      "gh?*-X*"
      "gh?*-f*"
    ];

    ghShellOperatorPatterns = denyShellOperatorsFor ["gh"];

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
        dirs = [
          ".agents/implementation-reports"
          ".agents/review-reports"
          ".agents/bug-reports"
          ".agents/failure-reports"
        ];
        files = [
          ".agents/implementation-reports/*.md"
          ".agents/review-reports/*.md"
          ".agents/bug-reports/*.md"
          ".agents/failure-reports/*.md"
        ];
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

        workflowArtifactDirectoryCreation = {
          bash =
            denyAll
            // allow [
              "mkdir .agents"
              "mkdir .agents/plans"
              "mkdir .agents/specs"
              "mkdir -p .agents"
              "mkdir -p .agents/plans"
              "mkdir -p .agents/specs"
            ]
            // deny (denyShellOperatorsFor ["mkdir"]);
        };

        agentsDateFetch = {
          bash =
            denyAll
            // allow [
              "TZ=Asia/Tokyo date +%Y%m%d-%H%M%S"
            ]
            // deny (denyShellOperatorsFor ["date"]);
        };

        testExecutionAsk = {
          bash = askAll;
        };

        full = {
          bash = "allow";
        };

        # Trusted execution allows common local implementation commands while
        # leaving unclassified executables approval-gated. Prefix-specific
        # `?` rules sort after allowances and keep operators/external effects
        # gated under OpenCode's last-match behavior.
        trustedLocalImplementation = let
          localCommands = [
            "bun"
            "cargo"
            "chmod"
            "cmake"
            "cp"
            "deno"
            "git"
            "go"
            "just"
            "make"
            "mkdir"
            "mv"
            "ninja"
            "nix"
            "nix-build"
            "nix-instantiate"
            "node"
            "npm"
            "pnpm"
            "python"
            "python3"
            "pytest"
            "rm"
            "ruff"
            "touch"
            "uv"
            "yarn"
            "zig"
          ];
        in {
          bash =
            askAll
            // allow (commandRulesFor localCommands)
            // ask [
              "aws *"
              "az *"
              "bun publish*"
              "cargo login*"
              "cargo logout*"
              "cargo owner*"
              "cargo publish*"
              "cargo yank*"
              "curl *"
              "docker push*"
              "gcloud *"
              "gh *"
              "kubectl *"
              "nix copy*"
              "npm access*"
              "npm adduser*"
              "npm deprecate*"
              "npm dist-tag*"
              "npm hook*"
              "npm login*"
              "npm logout*"
              "npm org*"
              "npm owner*"
              "npm profile*"
              "npm publish*"
              "npm star*"
              "npm team*"
              "npm token*"
              "npm unpublish*"
              "npm unstar*"
              "pnpm login*"
              "pnpm logout*"
              "pnpm publish*"
              "podman push*"
              "rsync *"
              "scp *"
              "ssh *"
              "terraform apply*"
              "terraform destroy*"
              "wget *"
              "yarn npm login*"
              "yarn npm logout*"
              "yarn npm publish*"
            ]
            // allow ghInspectionCommands
            // ask (
              ghMutationArgumentPatterns
              ++ ghShellOperatorPatterns
              ++ [
                "gh?*$(*"
                "gh?*<*"
                "gh?*`*"
                "git?*push*"
                "git?*send-pack*"
              ]
            )
            // askAmbiguousShellEffectsFor (localCommands ++ ["gh"]);
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
            // deny (denyShellOperatorsFor ["git"] ++ ["git?*--output*"]);
        };

        gitBranchPreparation = {
          bash =
            denyAll
            // allow [
              "git fetch*"
              "git switch*"
            ]
            // deny (denyShellOperatorsFor ["git"] ++ ["git?*--output*"]);
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
            // deny (denyShellOperatorsFor ["git" "nix" "nix-instantiate"]);
        };

        ghReviewInspection = {
          bash =
            denyAll
            // allow ghInspectionCommands
            // deny (ghShellOperatorPatterns ++ ghMutationArgumentPatterns);
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
      readOnlyBase = mergeMany [
        perm.read.workspace
        perm.write.none
        perm.execute.none
        perm.execute.agentsDateFetch
        perm.delegate.none
        perm.interact.none
        perm.network.none
        perm.context.full
      ];

      pureRead = merge readOnlyBase perm.execute.agentsDirectoryCreation;

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

      implementation = mergeMany [
        perm.read.workspace
        perm.write.full
        perm.execute.testExecutionAsk
        (perm.delegate.only [
          "researcher"
          "challenger"
          "focused-reviewer"
          "dissent-reviewer"
          "review-orchestrator"
          "tester"
        ])
        perm.interact.all
        perm.network.full
        perm.context.full
        perm.safety.externalAll
      ];

      implementationByPolicy = {
        normal = implementation;
        "trusted-vm" = merge implementation perm.execute.trustedLocalImplementation;
      };

      unrestrictedCommandReadWrite = mergeMany [
        perm.read.workspace
        perm.write.full
        perm.execute.full
        perm.context.full
        perm.safety.externalAll
      ];

      tempWorkspaceWithReports =
        perm.scope.reports ["read" "edit*"]
        (mergeMany [
          pureRead
          perm.write.tempWorkspace
        ]);

      safeEvidenceCollection = mergeMany [
        perm.execute.safeGitInspection
        perm.execute.safeValidation
      ];

      scoutFull = mergeMany [
        (perm.scope.plans ["edit*"] (perm.scope.specs ["edit*"] readOnlyBase))
        perm.execute.workflowArtifactDirectoryCreation
        perm.execute.safeGitInspection
        perm.execute.safeValidation
        perm.execute.ghReviewInspection
        perm.interact.question
        perm.context.full
        (perm.delegate.only [
          "explore"
          "researcher"
          "challenger"
          "focused-reviewer"
          "review-orchestrator"
          "tester"
          "taskmaster"
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
        perm.execute.testExecutionAsk
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

      reviewOrchestrator = mergeMany [
        reportsOnly
        perm.execute.safeGitInspection
        perm.execute.ghReviewInspection
        perm.interact.question
        perm.context.full
        (perm.delegate.only [
          "explore"
          "researcher"
          "focused-reviewer"
          "dissent-reviewer"
          "tester"
        ])
      ];
    };
  in {
    inherit merge mergeMany perm agentPerm;
  };
}
