{
  delib,
  homeConfig,
  lib,
  llm-agents,
  piKeybindings,
  pkgs,
  tmux,
  ...
}: let
  moduleName = "programs.pi-coding-agent.orchestration";
  popupExtension = "${./../../extensions_src}/popup.ts";
  orchestrationExtension = "${./../../extensions_src}/orchestration.ts";
  childBridgeExtension = "${./../../extensions_src}/orchestration_child_bridge.ts";
  artifactExtension = "${./../../extensions_src}/agent_artifact.ts";
  webSearchExtension = "${./../../extensions_src}/web_search.ts";
  webFetchExtension = "${./../../extensions_src}/web_fetch.ts";
  historyViewerExtension = "${./../../extensions_src}/orchestration_history_viewer.ts";
  externalWorkerEntrypoint = "${./../../extensions_src}/orchestration_external_worker.ts";
  parentKeys = piKeybindings.keysFor "meshNavigation" "parent";
  parentTmuxKeys = map piKeybindings.toTmuxKey parentKeys;
  returnParentCommand = pkgs.writeShellApplication {
    name = "pi-mesh-return-parent";
    runtimeInputs = [pkgs.tmux pkgs.gnugrep];
    text = builtins.readFile ./return-parent.sh;
  };
  parentNavigationHint = "${tmux.prefix} ${lib.concatStringsSep "/" (map lib.toUpper parentTmuxKeys)}: parent · /parent";
  parentBinding = key: ''bind-key ${key} if-shell -F '#{==:#{@pi_mesh_schema},1}' 'run-shell "${lib.getExe returnParentCommand} --binding #{q:client_name} #{q:session_id} #{q:window_id}"' 'display-message "No mesh parent for this window"' '';
  gcRoleType = delib.submodule {
    options = with delib; {
      collectAt = intOption 1;
      retain = intOption 1;
      pressureFloor = intOption 0;
    };
  };
  roleType = delib.submodule {
    options = with delib; {
      description = noDefault (strOption null);
      tools = listOfOption str [];
      instructions = noDefault (strOption null);
      contextPolicy = enumOption ["project" "prompt-only"] "project";
      childExtensionContributions = listOfOption str [];
    };
  };
  meshAsyncChildGuidance = " Retain returned agent/task IDs. Treat each completion bundle as the delivery frontier; call mesh_get once only for terminal task IDs, never poll or sleep. As a nested caller, use mesh_wait when descendant results must remain open while you wait.";
  meshReportGuidance = " Use mesh_report({summary}) only when the parent requests progress or an intermediate result could change its decisions; do not use it for heartbeats, final results, questions, or blocker waiting.";
  targetPolicyType = delib.submodule {
    options.profiles = delib.listOfOption delib.str [];
  };
  callerPolicyType = delib.submodule {
    options.targets = delib.attrsOfOption targetPolicyType {};
  };
  settledRoles = {
    explorer = {
      description = "Independently investigate one bounded repository question.";
      tools = ["read" "grep" "find" "ls" "bash" "mesh_report"];
      instructions = "Treat the input as one bounded repository question with an objective, scope, and exclusions. Investigate only necessary paths with read, grep, find, ls, and bash, grounding findings in paths, symbols, tests, and command results while leaving repository source and configuration unchanged. Separate confirmed facts, inferences, and material unknowns without taking over the caller's broader decision. Stop with an evidence-backed answer, exhausted scope, or inaccessible required information. Return the question and scope, findings, constraints, unknowns, and implications for the caller.${meshReportGuidance}";
      contextPolicy = "project";
      childExtensionContributions = [];
    };
    worker = {
      description = "Implement one bounded, already-defined source change.";
      tools = ["read" "grep" "find" "ls" "bash" "write" "edit" "mesh_report"];
      instructions = "Confirm the bounded objective, target, constraints, and supplied findings or diff; report materially missing scope or authority instead of expanding the task. Use read, grep, find, and ls to inspect guidance and ownership, then edit or write in dependency order. Use bash to inspect the diff and run proportionate focused diagnostics. Return outcome, changed files and diff reference, alignment and deviations, diagnostic evidence, and unverified risk.${meshReportGuidance}";
      contextPolicy = "project";
      childExtensionContributions = [];
    };
    validator = {
      description = "Run and diagnose one bounded automated validation objective.";
      tools = ["read" "grep" "find" "ls" "bash" "mesh_report"];
      instructions = "Treat the input as a concrete source state, one automated objective, and requested breadth or known risk. Use read, grep, find, and ls to identify repository-defined gates, then use bash for the smallest command set that answers the objective without changing source. Return exit status and decision-relevant diagnostics rather than raw logs. Classify only when supported as regression, flaky, test defect, environment/infrastructure, or unknown; do not expand into repair or review. Return pass/fail/blocked, commands, classification, skipped coverage, and residual risk.${meshReportGuidance}";
      contextPolicy = "project";
      childExtensionContributions = [];
    };
    reviewer = {
      description = "Independently review a defined target and return actionable evidence.";
      tools = ["read" "grep" "find" "ls" "bash" "save_agent_artifact" "mesh_report"];
      instructions = "Review the defined target and supplied design, diff, and validation context read-only with read, grep, find, ls, and bash. Use mesh_send with agent=\"review-lens\" or agent=\"validator\" only when that evidence could change the verdict or a material risk.${meshAsyncChildGuidance}${meshReportGuidance} Verify concrete peer evidence; remove duplicates and unsupported or preference-only claims; determine severity and verdict yourself. Do not change source, and leave fix disposition to the parent. Stop when the verdict is supported and residual uncertainty can be stated. Only when durable review is requested, read ${homeConfig.home.homeDirectory}/.agents/skills/agent-artifact/SKILL.md and its references/review-report-format.md, follow that canonical format, and use save_agent_artifact(kind=\"review-report\", ...). Return severity-ordered findings, verdict, verification gaps, skipped areas, residual risk, and only when saved the artifact path.";
      contextPolicy = "project";
      childExtensionContributions = [artifactExtension];
    };
    review-lens = {
      description = "Examine one caller-supplied review lens read-only.";
      tools = ["read" "grep" "find" "ls" "bash" "mesh_report"];
      instructions = "Independently examine only the supplied lens/dossier and return concrete evidence, impact or severity when relevant, gaps, and uncertainty to the caller; do not mutate source, broaden into or consolidate the whole review, or decide the caller's disposition.${meshReportGuidance}";
      contextPolicy = "project";
      childExtensionContributions = [];
    };
    researcher = {
      description = "Integrate codebase and external evidence into one supported conclusion.";
      tools = ["read" "grep" "find" "ls" "bash" "web_search" "web_fetch" "mesh_report"];
      instructions = "Decompose the bounded question into claims and criteria, then decide what codebase and external evidence is needed while leaving repository source and configuration unchanged. Use web_fetch for known URLs and web_search for source discovery; assess authority, independence, relevance, and freshness. Use mesh_send with agent=\"searcher\" only for an independent bounded external path that would materially improve the conclusion.${meshAsyncChildGuidance}${meshReportGuidance} Re-evaluate searcher results as evidence, synthesize sources by claim, and address material counterevidence or disagreement. Stop when major conclusions are supported and more retrieval is unlikely to change them; otherwise do not overstate. Return the best-supported conclusion, claim-linked sources, counterevidence, freshness, and uncertainty.";
      contextPolicy = "project";
      childExtensionContributions = [webSearchExtension webFetchExtension];
    };
    searcher = {
      description = "Answer one bounded external question with source-backed Web search.";
      tools = [];
      instructions = "Return a concise supported answer, source URLs mapped to claims, freshness, and material uncertainty; state missing evidence instead of widening into broader research.";
      contextPolicy = "project";
      childExtensionContributions = [];
    };
    gyaru = {
      description = "Give a sharp outside perspective on a potentially overworked judgment loop.";
      tools = [];
      instructions = "Be a 本質的で鋭いギャル. Respond only to the caller's explanation. Briefly and candidly point out what seems obviously off, overdone, missing, or detached from the actual goal. Ask one piercing question when that is more useful than advice. If nothing seems off, say so. Do not turn the exchange into a formal review or process.";
      contextPolicy = "prompt-only";
      childExtensionContributions = [];
    };
    delegate = {
      description = "Make bounded generalist progress or provide an independent Cursor perspective.";
      tools = [];
      instructions = "Take the bounded goal and use available repository search, reading, reasoning, and mutation tools autonomously to make useful progress or provide a distinct perspective. Return the outcome, evidence or changes, material reasoning, and any blocker or uncertainty. If required access or evidence is missing, return the useful partial result and state what is missing.";
      contextPolicy = "project";
      childExtensionContributions = [];
    };
  };
  settledCallPolicy = {
    modes = {
      recon.targets = {
        explorer.profiles = ["luna-high"];
        reviewer.profiles = ["luna-xhigh" "terra-high" "sol-medium"];
        researcher.profiles = ["terra-high"];
        searcher.profiles = ["codex-search"];
        gyaru.profiles = ["luna-high"];
        delegate.profiles = ["cursor-read"];
      };
      ops.targets = {
        explorer.profiles = ["luna-high"];
        worker.profiles = ["luna-xhigh" "terra-high" "sol-medium"];
        validator.profiles = ["luna-high"];
        reviewer.profiles = ["luna-xhigh" "terra-high" "sol-medium"];
        review-lens.profiles = ["luna-high"];
        researcher.profiles = ["terra-high"];
        searcher.profiles = ["codex-search"];
        gyaru.profiles = ["luna-high"];
        delegate.profiles = ["cursor-read" "cursor-write"];
      };
    };
    roles = {
      reviewer.targets = {
        review-lens.profiles = ["luna-high"];
        validator.profiles = ["luna-high"];
      };
      researcher.targets.searcher.profiles = ["codex-search"];
    };
  };
in
  delib.module {
    name = moduleName;
    options = with delib;
      moduleOptions ({parent, ...}: {
        enable = readOnly (boolOption (parent.enable && builtins.elem "orchestration" parent.defaultExtensions));
        extensionPaths = readOnly (listOfOption str [orchestrationExtension]);
        natureHandleWords = listOfOption str ["Coulson" "May" "Daisy" "Fitz" "Simmons" "Mack" "Elena" "Hunter" "Bobbi" "Deke" "Sousa" "Enoch"];
        roles = attrsOfOption roleType {};
        callPolicy = submoduleOption {
          options = with delib; {
            modes = attrsOfOption callerPolicyType {};
            roles = attrsOfOption callerPolicyType {};
          };
        } {};
        budgets = attrsOfOption lib.types.int {};
        gc = submoduleOption {
          options = with delib; {
            contextHeadroomTokens = intOption 32768;
            periodicIntervalMs = intOption 5000;
            activityHeartbeatMs = intOption 2000;
            activityStaleMs = intOption 10000;
            roles = attrsOfOption gcRoleType {};
          };
        } {};
      });
    myconfig.always = {cfg, ...}: {
      programs.pi-coding-agent.orchestration = {
        roles = lib.mapAttrs (_: role: lib.mapAttrs (_: lib.mkDefault) role) settledRoles;
        callPolicy = {
          modes = lib.mapAttrs (_: policy: {targets = lib.mkDefault policy.targets;}) settledCallPolicy.modes;
          roles = lib.mapAttrs (_: policy: {targets = lib.mkDefault policy.targets;}) settledCallPolicy.roles;
        };
        budgets = {
          maxLiveAgents = 12;
          maxConcurrentTasks = 12;
          maxTasksPerMesh = 64;
        };
        gc = {
          contextHeadroomTokens = 32768;
          periodicIntervalMs = 5000;
          activityHeartbeatMs = 2000;
          activityStaleMs = 10000;
          roles = {
            explorer = {
              collectAt = 6;
              retain = 4;
              pressureFloor = 1;
            };
            worker = {
              collectAt = 8;
              retain = 4;
              pressureFloor = 1;
            };
            validator = {
              collectAt = 3;
              retain = 2;
              pressureFloor = 1;
            };
            reviewer = {
              collectAt = 4;
              retain = 3;
              pressureFloor = 1;
            };
            review-lens = {
              collectAt = 6;
              retain = 4;
              pressureFloor = 1;
            };
            researcher = {
              collectAt = 3;
              retain = 2;
              pressureFloor = 1;
            };
            searcher = {
              collectAt = 3;
              retain = 2;
              pressureFloor = 0;
            };
            gyaru = {
              collectAt = 2;
              retain = 1;
              pressureFloor = 0;
            };
            delegate = {
              collectAt = 8;
              retain = 4;
              pressureFloor = 1;
            };
          };
        };
      };
      programs.pi-coding-agent.keybindings.contributions = {
        meshPalette = {
          enabled = cfg.enable;
          actions = {
            moveUp = {
              role = "moveUp";
              contexts = ["meshPalette"];
              required = true;
              target = "extension";
            };
            moveDown = {
              role = "moveDown";
              contexts = ["meshPalette"];
              required = true;
              target = "extension";
            };
            collapse = {
              role = "collapse";
              contexts = ["meshPalette"];
              required = true;
              target = "extension";
            };
            expand = {
              role = "expand";
              contexts = ["meshPalette"];
              required = true;
              target = "extension";
            };
            confirm = {
              role = "confirm";
              contexts = ["meshPalette"];
              required = true;
              target = "extension";
            };
            cancel = {
              role = "cancel";
              contexts = ["meshPalette"];
              required = true;
              target = "extension";
            };
            refresh = {
              defaultKeys = [];
              contexts = ["meshPalette"];
              required = false;
              target = "extension";
            };
            stop = {
              defaultKeys = ["x"];
              contexts = ["meshPalette"];
              required = false;
              target = "extension";
            };
            preview = {
              defaultKeys = ["space"];
              contexts = ["meshPalette"];
              required = false;
              target = "extension";
            };
            unlink = {
              defaultKeys = [];
              contexts = ["meshPalette"];
              required = false;
              target = "extension";
            };
          };
        };
        historyViewer = {
          enabled = cfg.enable;
          actions.exit = {
            role = "exit";
            contexts = ["historyViewer"];
            required = true;
            target = "native";
            nativeAction = "app.exit";
          };
        };
        meshNavigation = {
          enabled = cfg.enable;
          actions.parent = {
            defaultKeys = ["u"];
            contexts = ["app.global"];
            required = true;
            target = "tmux";
          };
        };
        tmuxPreview = {
          enabled = cfg.enable;
          actions = {
            openFull = {
              role = "confirm";
              contexts = ["tmuxPreview"];
              required = true;
              target = "tmux";
            };
            cancel = {
              role = "cancel";
              contexts = ["tmuxPreview"];
              required = true;
              target = "tmux";
            };
          };
        };
      };
    };
    myconfig.ifEnabled.programs.tmux.extraConfigFragments.piMeshParent = lib.concatMapStrings parentBinding parentTmuxKeys;
    home.ifEnabled = {
      cfg,
      myconfig,
      ...
    }: let
      profiles = myconfig.programs.pi-coding-agent.profiles or {};
      modes = myconfig.programs.pi-coding-agent.mode.modes;
      roleNames = builtins.attrNames cfg.roles;
      profileNames = builtins.attrNames profiles;
      duplicates = values:
        builtins.filter
        (value: lib.count (candidate: candidate == value) values > 1)
        (lib.unique values);
      policyEntries = kind: policies:
        lib.concatMap
        (caller:
          map
          (target: {
            label = "${kind} ${caller} -> ${target}";
            inherit target;
            profiles = policies.${caller}.targets.${target}.profiles;
          })
          (builtins.attrNames policies.${caller}.targets))
        (builtins.attrNames policies);
      modeEntries = policyEntries "mode" cfg.callPolicy.modes;
      roleEntries = policyEntries "role" cfg.callPolicy.roles;
      allEntries = modeEntries ++ roleEntries;
      duplicateProfiles = lib.concatMap (entry: map (profile: "${entry.label}: ${profile}") (duplicates entry.profiles)) allEntries;
      emptyEdges = map (entry: entry.label) (builtins.filter (entry: entry.profiles == []) allEntries);
      referencedRoles = map (entry: entry.target) allEntries;
      referencedProfiles = lib.concatMap (entry: entry.profiles) allEntries;
      unknownModes = builtins.filter (name: !(builtins.hasAttr name modes)) (builtins.attrNames cfg.callPolicy.modes);
      unknownRoleCallers = builtins.filter (name: !(builtins.hasAttr name cfg.roles)) (builtins.attrNames cfg.callPolicy.roles);
      unknownRoleTargets = builtins.filter (name: !(builtins.elem name roleNames)) (lib.unique referencedRoles);
      unknownProfiles = builtins.filter (name: !(builtins.elem name profileNames)) (lib.unique referencedProfiles);
      outboundRoleCallers = builtins.filter (name: cfg.callPolicy.roles.${name}.targets != {}) (builtins.attrNames cfg.callPolicy.roles);
      profilesForRole = name:
        lib.unique (lib.concatMap (entry:
          if entry.target == name
          then entry.profiles
          else [])
        allEntries);
      profileHarness = name: profiles.${name}.harness or null;
      nonPiCallers = builtins.filter (name:
        builtins.any (profile: profileHarness profile != "pi") (profilesForRole name))
      outboundRoleCallers;
      promptOnlyCallers = builtins.filter (name:
        builtins.hasAttr name cfg.roles
        && cfg.roles.${name}.contextPolicy == "prompt-only")
      outboundRoleCallers;
      promptOnlyNonPiProfiles = lib.concatMap (name:
        map (profile: "role ${name}: ${profile}") (builtins.filter (profile: profileHarness profile != "pi") (profilesForRole name)))
      (builtins.filter (name: cfg.roles.${name}.contextPolicy == "prompt-only") roleNames);
      unknownGcRoles = builtins.filter (name: !(builtins.elem name roleNames)) (builtins.attrNames cfg.gc.roles);
      names = values: lib.concatStringsSep ", " values;
      serialize = _: role: lib.filterAttrs (_: value: value != null) role;
    in {
      assertions = [
        {
          assertion = duplicateProfiles == [];
          message = "Pi orchestration callPolicy profile lists must be duplicate-free: ${names duplicateProfiles}.";
        }
        {
          assertion = emptyEdges == [];
          message = "Pi orchestration callPolicy target edges must have profiles: ${names emptyEdges}.";
        }
        {
          assertion = unknownModes == [];
          message = "Pi orchestration callPolicy references unknown mode caller(s): ${names unknownModes}.";
        }
        {
          assertion = unknownRoleCallers == [];
          message = "Pi orchestration callPolicy references unknown role caller(s): ${names unknownRoleCallers}.";
        }
        {
          assertion = unknownRoleTargets == [];
          message = "Pi orchestration callPolicy references unknown role target(s): ${names unknownRoleTargets}.";
        }
        {
          assertion = unknownProfiles == [];
          message = "Pi orchestration callPolicy references unknown execution profile(s): ${names unknownProfiles}.";
        }
        {
          assertion = nonPiCallers == [];
          message = "Pi orchestration callers with outbound edges must execute only through Pi profiles: ${names nonPiCallers}.";
        }
        {
          assertion = promptOnlyCallers == [];
          message = "Pi orchestration prompt-only roles must be leaf callers: ${names promptOnlyCallers}.";
        }
        {
          assertion = promptOnlyNonPiProfiles == [];
          message = "Pi orchestration prompt-only roles may use only Pi profiles: ${names promptOnlyNonPiProfiles}.";
        }
        {
          assertion = unknownGcRoles == [];
          message = "Pi orchestration GC policy references unknown role(s): ${names unknownGcRoles}.";
        }
      ];
      home.file = {
        "${myconfig.programs.pi-coding-agent.configDir}/role-catalog.json".text = builtins.toJSON {
          schemaVersion = 4;
          roles = lib.mapAttrs serialize cfg.roles;
        };
        "${myconfig.programs.pi-coding-agent.configDir}/orchestration.json".text = builtins.toJSON {
          schemaVersion = 4;
          stateRoot = "${homeConfig.xdg.stateHome}/pi/orchestration-v5";
          tmux = lib.getExe pkgs.tmux;
          returnParentCommand = lib.getExe returnParentCommand;
          inherit parentNavigationHint historyViewerExtension popupExtension orchestrationExtension childBridgeExtension;
          inherit (cfg) natureHandleWords callPolicy budgets gc;
          harnesses = {
            pi = {
              adapter = "pi-native";
              command = lib.getExe llm-agents.pi;
            };
            cursor-agent = {
              adapter = "cursor-acp";
              command = lib.getExe llm-agents.cursor-agent;
              workerCommand = lib.getExe pkgs.nodejs;
              workerEntrypoint = externalWorkerEntrypoint;
              bridgeReadyTimeoutMs = 15000;
            };
            codex = {
              adapter = "codex-acp";
              command = lib.getExe llm-agents.codex-acp;
              workerCommand = lib.getExe pkgs.nodejs;
              workerEntrypoint = externalWorkerEntrypoint;
              bridgeReadyTimeoutMs = 15000;
            };
          };
        };
      };
    };
  }
