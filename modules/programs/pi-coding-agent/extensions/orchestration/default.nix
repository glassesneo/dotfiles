{
  delib,
  homeConfig,
  lib,
  llm-agents,
  piArtifactRuntime,
  piKeybindings,
  pkgs,
  tmux,
  ...
}: let
  moduleName = "programs.pi-coding-agent.orchestration";
  popupExtension = "${./../../extensions_src}/popup.ts";
  orchestrationExtension = "${./../../extensions_src}/orchestration.ts";
  childBridgeExtension = "${./../../extensions_src}/orchestration_child_bridge.ts";
  artifactExtension = piArtifactRuntime.extensionPath;
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
      selector = submoduleOption {
        options = with delib; {
          agent = noDefault (strOption null);
          access = noDefault (enumOption ["read" "write"] null);
        };
      } {};
      description = noDefault (strOption null);
      tools = listOfOption str [];
      instructions = noDefault (strOption null);
      contextPolicy = enumOption ["project" "prompt-only"] "project";
      childExtensionContributions = listOfOption str [];
    };
  };
  meshAsyncChildGuidance = " Retain returned agent/task IDs and continue useful work independent of pending descendants. As a nested caller, do not end the response to wait because settling completes your active task; when descendant results are required, call mesh_wait once with all pending descendant task IDs. Treat each completion bundle as the delivery frontier and call mesh_get once only for terminal task IDs; never poll, sleep, or run time-filling commands.";
  meshReportGuidance = " Use mesh_report({summary}) only when the parent requests progress or an intermediate result could change its decisions; do not use it for heartbeats, final results, questions, or blocker waiting.";
  targetPolicyType = delib.submodule {
    options.profiles = delib.listOfOption delib.str [];
  };
  callerPolicyType = delib.submodule {
    options.targets = delib.attrsOfOption targetPolicyType {};
  };
  resultContract = " Return the outcome, changed paths when any, verification evidence, missing evidence, and decisions needed from the caller.";
  repositoryTools = access: extraTools: ["read" "grep" "find" "ls" "bash"] ++ lib.optionals (access == "write") ["write" "edit"] ++ extraTools ++ ["mesh_report"];
  mkRepositoryRole = agent: access: description: instructions: contributions: extraTools: {
    selector = {inherit agent access;};
    inherit description;
    tools = repositoryTools access extraTools;
    instructions = "${instructions}${resultContract}${meshReportGuidance}";
    contextPolicy = "project";
    childExtensionContributions = contributions;
  };
  mkStandardRole = access: description: instructions: {
    selector = {
      agent = "standard";
      inherit access;
    };
    inherit description;
    tools = [];
    instructions = "${instructions}${resultContract}";
    contextPolicy = "project";
    childExtensionContributions = [];
  };
  settledRoles = {
    small-read = mkRepositoryRole "small" "read" "Handle a small, low-judgment read-only repository task or command-result check." "Keep the bounded source/configuration unchanged and use only the investigation needed for the requested result." [] [];
    small-write = mkRepositoryRole "small" "write" "Handle a small, low-judgment repository change." "Confirm the bounded target, make the smallest authorized change, inspect the diff, and run proportionate focused checks." [] [];
    standard-read = mkStandardRole "read" "Own a normal repository investigation without changing source or configuration." "Investigate the assignment with the harness-provided repository tools. Return missing operations rather than assuming Pi shell or validation access.";
    standard-write = mkStandardRole "write" "Own a normal repository implementation, repair, and self-verification." "Explore, implement, validate, recover from mistakes, and return an integrable result within the assigned scope.";
    advanced-read = mkRepositoryRole "advanced" "read" "Handle difficult read-only judgment across multiple repository invariants." "Investigate and evaluate the bounded problem without source changes. Delegate only when a permitted independent result materially improves the conclusion.${meshAsyncChildGuidance}" [artifactExtension] ["save_agent_artifact"];
    advanced-write = mkRepositoryRole "advanced" "write" "Handle a difficult repository change spanning multiple invariants." "Explore, implement, and verify the bounded change. Delegate only when a permitted independent result materially improves the outcome.${meshAsyncChildGuidance}" [artifactExtension] ["save_agent_artifact"];
    research = {
      selector = {
        agent = "research";
        access = "read";
      };
      description = "Collect repository and Web evidence, assess sources, and synthesize a supported conclusion.";
      tools = ["read" "grep" "find" "ls" "bash" "web_search" "web_fetch" "mesh_report"];
      instructions = "Decompose the bounded question into claims and evidence needs while leaving source and configuration unchanged. Assess authority, relevance, independence, and freshness. Use mesh_send with agent=\"search\" and access=\"read\" only for an independent Web path that materially improves the conclusion.${meshAsyncChildGuidance}${meshReportGuidance} Return claim-linked sources, counterevidence, and uncertainty.";
      contextPolicy = "project";
      childExtensionContributions = [webSearchExtension webFetchExtension];
    };
    perspective = {
      selector = {
        agent = "perspective";
        access = "read";
      };
      description = "Reframe a supplied dossier from an isolated outside perspective.";
      tools = [];
      instructions = "Receive only the caller's dossier; you have no repository context, tools, skills, prompt templates, or child roles. Identify hidden assumptions, alternate decompositions, and natural alternatives without inventing repository facts. Return the strongest reframing, material assumptions, supported alternatives, and any missing dossier element.";
      contextPolicy = "prompt-only";
      childExtensionContributions = [];
    };
    search = {
      selector = {
        agent = "search";
        access = "read";
      };
      description = "Answer one bounded external question with source-backed Web search.";
      tools = [];
      instructions = "Return a concise supported answer, source URLs mapped to claims, freshness, and material uncertainty; state missing evidence instead of widening the task.";
      contextPolicy = "project";
      childExtensionContributions = [];
    };
  };
  edge = profile: {profiles = [profile];};
  settledCallPolicy = {
    modes = {
      recon.targets = {
        small-read = edge "small-read";
        standard-read = edge "standard-read";
        advanced-read = edge "advanced";
        research = edge "research";
        perspective = edge "perspective";
      };
      ops.targets = {
        small-read = edge "small-read";
        small-write = edge "small-write";
        standard-read = edge "standard-read";
        standard-write = edge "standard-write";
        advanced-read = edge "advanced";
        advanced-write = edge "advanced";
        research = edge "research";
        perspective = edge "perspective";
      };
    };
    roles = {
      advanced-read.targets = {
        small-read = edge "small-read";
        standard-read = edge "standard-read";
        research = edge "research";
        perspective = edge "perspective";
      };
      advanced-write.targets = {
        small-read = edge "small-read";
        small-write = edge "small-write";
        standard-read = edge "standard-read";
        standard-write = edge "standard-write";
        research = edge "research";
        perspective = edge "perspective";
      };
      research.targets.search = edge "search";
    };
  };
  gcBase = {
    small-read = {
      collectAt = 6;
      retain = 4;
      pressureFloor = 1;
    };
    small-write = {
      collectAt = 8;
      retain = 4;
      pressureFloor = 1;
    };
    standard-read = {
      collectAt = 8;
      retain = 4;
      pressureFloor = 1;
    };
    standard-write = {
      collectAt = 8;
      retain = 4;
      pressureFloor = 1;
    };
    advanced-read = {
      collectAt = 4;
      retain = 3;
      pressureFloor = 1;
    };
    advanced-write = {
      collectAt = 4;
      retain = 3;
      pressureFloor = 1;
    };
    research = {
      collectAt = 3;
      retain = 2;
      pressureFloor = 1;
    };
    perspective = {
      collectAt = 2;
      retain = 1;
      pressureFloor = 0;
    };
    search = {
      collectAt = 3;
      retain = 2;
      pressureFloor = 0;
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
      args.shared.piOrchestration.enabled = cfg.enable;
      programs.pi-coding-agent.orchestration = {
        roles = lib.mapAttrs (_: role: lib.mapAttrs (_: lib.mkDefault) role) settledRoles;
        callPolicy = {
          modes = lib.mapAttrs (_: policy: {targets = lib.mkDefault policy.targets;}) settledCallPolicy.modes;
          roles = lib.mapAttrs (_: policy: {targets = lib.mkDefault policy.targets;}) settledCallPolicy.roles;
        };
        budgets = lib.mapAttrs (_: lib.mkDefault) {
          maxLiveAgents = 12;
          maxConcurrentTasks = 12;
          maxTasksPerMesh = 64;
        };
        gc.roles = lib.mapAttrs (_: role: lib.mapAttrs (_: lib.mkDefault) role) gcBase;
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
            toggleTerminal = {
              defaultKeys = ["t"];
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
      emptyEdges = map (entry: entry.label) (builtins.filter (entry: builtins.length entry.profiles != 1) allEntries);
      selectorKey = target:
        if !(builtins.hasAttr target cfg.roles)
        then "unknown:${target}"
        else let
          selector = cfg.roles.${target}.selector;
          agent =
            if builtins.isString selector.agent
            then selector.agent
            else "<invalid>";
        in "${agent}:${
          if selector.access == null
          then ""
          else selector.access
        }";
      ambiguousSelectors = lib.concatMap (kindPolicies:
        lib.concatMap (caller: let
          targets = builtins.attrNames kindPolicies.${caller}.targets;
          keys = map selectorKey targets;
        in
          map (key: "${caller}: ${key}") (duplicates keys)) (builtins.attrNames kindPolicies)) [cfg.callPolicy.modes cfg.callPolicy.roles];
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
      missingGcRoles = builtins.filter (name: !(builtins.hasAttr name cfg.gc.roles)) roleNames;
      invalidSelectors = builtins.filter (name: let selector = cfg.roles.${name}.selector; in !(builtins.isString selector.agent) || selector.agent == "") roleNames;
      searchOnRoot = lib.concatMap (mode: map (target: "${mode}: ${target}") (builtins.filter (target: builtins.hasAttr target cfg.roles && cfg.roles.${target}.selector.agent == "search") (builtins.attrNames cfg.callPolicy.modes.${mode}.targets))) (builtins.attrNames cfg.callPolicy.modes);
      searchFromNonResearch = lib.concatMap (caller: map (target: "${caller}: ${target}") (builtins.filter (target: builtins.hasAttr target cfg.roles && cfg.roles.${target}.selector.agent == "search") (builtins.attrNames cfg.callPolicy.roles.${caller}.targets))) (builtins.filter (caller: caller != "research") (builtins.attrNames cfg.callPolicy.roles));
      names = values: lib.concatStringsSep ", " values;
    in {
      assertions = [
        {
          assertion = duplicateProfiles == [];
          message = "Pi orchestration callPolicy profile lists must be duplicate-free: ${names duplicateProfiles}.";
        }
        {
          assertion = emptyEdges == [];
          message = "Pi orchestration callPolicy target edges must have exactly one profile: ${names emptyEdges}.";
        }
        {
          assertion = ambiguousSelectors == [];
          message = "Pi orchestration selectors must be unique for each caller: ${names ambiguousSelectors}.";
        }
        {
          assertion = invalidSelectors == [];
          message = "Pi orchestration roles must define a non-empty selector agent: ${names invalidSelectors}.";
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
        {
          assertion = missingGcRoles == [];
          message = "Pi orchestration GC policy must cover every role: ${names missingGcRoles}.";
        }
        {
          assertion = searchOnRoot == [];
          message = "Pi orchestration must not publish search on a root caller: ${names searchOnRoot}.";
        }
        {
          assertion = searchFromNonResearch == [];
          message = "Pi orchestration search must be reachable only from research: ${names searchFromNonResearch}.";
        }
      ];
      home.file = {
        "${myconfig.programs.pi-coding-agent.configDir}/role-catalog.json".text = builtins.toJSON {
          schemaVersion = 6;
          roles = cfg.roles;
        };
        "${myconfig.programs.pi-coding-agent.configDir}/orchestration.json".text = builtins.toJSON {
          schemaVersion = 5;
          stateRoot = "${homeConfig.xdg.stateHome}/pi/orchestration-v9";
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
              modelIds = myconfig.programs.pi-coding-agent.cursorAcpModelIds;
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
