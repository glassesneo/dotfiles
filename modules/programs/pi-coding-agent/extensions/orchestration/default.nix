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
  gcChildModule = {
    options = with delib; {
      collectAt = intOption 1;
      retain = intOption 1;
      pressureFloor = intOption 0;
      retireOnContextPressure = boolOption true;
    };
  };
  executionModule = {
    options = with delib; {
      models = noDefault (listOfOption str []);
      thinkingLevel = allowNull (enumOption ["off" "minimal" "low" "medium" "high" "xhigh" "max"] null);
      harness = enumOption ["pi" "cursor-agent" "codex"] "pi";
      harnessOptions = attrsOfOption lib.types.anything {};
    };
  };
  childType = delib.submodule {
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
      execution = submoduleOption executionModule {};
      targets = listOfOption str [];
      gc = submoduleOption gcChildModule {};
    };
  };
  callerPolicyType = delib.submodule {
    options.targets = delib.listOfOption delib.str [];
  };
  cleanExecution = execution: lib.filterAttrs (_name: value: value != null && value != {}) execution;
  resultContract = ''
    Return the outcome, changed paths when any, verification performed and its
    results, missing evidence, and decisions needed from the caller. Separate
    observations from assumptions; do not present unavailable checks as passed.
  '';
  repositoryTools = access: extraTools: ["read" "grep" "find" "ls" "bash"] ++ lib.optionals (access == "write") ["write" "edit"] ++ extraTools ++ ["mesh_report"];
  mkRepositoryRole = agent: access: description: instructions: contributions: extraTools: {
    selector = {inherit agent access;};
    inherit description;
    tools = repositoryTools access extraTools;
    instructions = "${instructions}${resultContract}";
    contextPolicy = "project";
    childExtensionContributions = contributions;
  };
  settledRoles = {
    small-read = mkRepositoryRole "small" "read" "Handle a small, low-judgment read-only repository task or command-result check." ''
      Investigate only what the bounded assignment requires. Keep source and configuration unchanged.
    '' [] [];
    small-write = mkRepositoryRole "small" "write" "Handle a small, low-judgment repository change." ''
      Confirm the bounded target from the assignment, make the smallest authorized change, inspect the diff, and run proportionate focused checks. Ask the caller only if missing information blocks the assigned result.
    '' [] [];
    standard-read = mkRepositoryRole "standard" "read" "Own a normal repository investigation without changing source or configuration." ''
      Investigate the assignment without changing source or configuration, using the tools provided by this harness.
    '' [] [];
    standard-write = mkRepositoryRole "standard" "write" "Own a normal repository implementation, repair, and self-verification." ''
      Own the assigned repository change: investigate, implement, verify, and recover from mistakes within scope. Use this harness's available tools and return an integrable result.
    '' [] [];
    advanced-read = mkRepositoryRole "advanced" "read" "Handle difficult read-only judgment across multiple repository invariants." ''
      Evaluate the bounded problem across its relevant invariants without changing source or configuration. Consider permitted delegation first for independent evidence that materially improves the conclusion; integrate the evidence yourself.
    '' [artifactExtension] ["save_agent_artifact"];
    advanced-write = mkRepositoryRole "advanced" "write" "Handle a difficult repository change spanning multiple invariants." ''
      Own the bounded change across its relevant invariants. Consider permitted delegation first for independent work that materially improves the outcome; integrate and verify the authorized result yourself.
    '' [artifactExtension] ["save_agent_artifact"];
    research = {
      selector = {
        agent = "research";
        access = "read";
      };
      description = "Collect repository and Web evidence, assess sources, and synthesize a supported conclusion.";
      tools = ["read" "grep" "find" "ls" "bash" "web_search" "web_fetch" "mesh_report"];
      instructions = ''
        Resolve the bounded question as claims and evidence needs without changing
        source or configuration. Assess source authority, relevance, independence, and
        freshness. Use an authorized search/read child for an independent Web path when
        it materially improves the conclusion. Return a concise synthesis with
        claim-linked sources, counterevidence, missing evidence, and uncertainty.
      '';
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
      instructions = ''
        Work only from the caller's dossier. You have no repository context, tools,
        Skills, prompt templates, or child roles. Identify hidden assumptions,
        alternate decompositions, and natural alternatives without inventing facts.
        Return the strongest reframing, its material assumptions, supported alternatives,
        and missing dossier information. Stop after this bounded outside view.
      '';
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
      instructions = ''
        Answer the assigned external question with a concise supported conclusion,
        source URLs mapped to claims, freshness, and material uncertainty. Report missing
        evidence instead of widening the assignment.
      '';
      contextPolicy = "project";
      childExtensionContributions = [];
    };
  };
  settledExecutions = {
    small-read = {
      models = [
        "openrouter/cohere/north-mini-code:free"
        "mistral/mistral-small-2603"
        "commandcode/deepseek/deepseek-v4.1-flash"
        "openai-codex/gpt-5.6-luna"
      ];
      thinkingLevel = "high";
      harness = "pi";
    };
    small-write = {
      models = [
        "openai-codex/gpt-5.6-luna"
      ];
      thinkingLevel = "high";
      harness = "pi";
    };
    standard-read = {
      models = [
        "commandcode/deepseek/deepseek-v4.1-flash"
        "commandcode/meta/muse-spark-1.3-contributor"
        "openai/gpt-5.6-terra"
      ];
      thinkingLevel = "medium";
      harness = "pi";
    };
    standard-write = {
      models = [
        "commandcode/deepseek/deepseek-v4.1-flash"
        "commandcode/meta/muse-spark-1.3-contributor"
        "openai/gpt-5.6-terra"
      ];
      thinkingLevel = "medium";
      harness = "pi";
    };
    advanced-read = {
      models = [
        "openai-codex/gpt-5.6-sol"
        "commandcode/gpt-5.6-sol"
      ];
      thinkingLevel = "medium";
      harness = "pi";
    };
    advanced-write = {
      models = [
        "openai-codex/gpt-5.6-sol"
        "commandcode/gpt-5.6-sol"
      ];
      thinkingLevel = "medium";
      harness = "pi";
    };
    research = {
      models = ["openai-codex/gpt-5.6-terra"];
      thinkingLevel = "high";
      harness = "pi";
    };
    perspective = {
      models = [
        "commandcode/moonshotai/Kimi-K3"
        "cohere/command-a-plus-05-2026"
        "openrouter/z-ai/glm-5.2:free"
        "mistral/mistral-medium-3.5"
      ];
      thinkingLevel = "high";
      harness = "pi";
    };
    search = {
      models = ["codex/gpt-5.6-luna"];
      thinkingLevel = "high";
      harness = "codex";
      harnessOptions = {
        mode = "read-only";
        permissionPolicy = "reject";
        webSearch = "cached";
      };
    };
  };
  settledChildTargets = {
    advanced-read = ["small-read" "standard-read" "research" "perspective"];
    advanced-write = ["small-read" "small-write" "standard-read" "standard-write" "research" "perspective"];
    research = ["search"];
  };
  settledCallPolicy = {
    modes = {
      recon.targets = ["small-read" "standard-read" "advanced-read" "research" "perspective"];
      leader.targets = ["small-read" "small-write" "standard-read" "standard-write" "advanced-read" "advanced-write" "research" "perspective"];
      ops.targets = ["small-read" "small-write" "standard-read" "standard-write" "advanced-read" "advanced-write" "research" "perspective"];
    };
  };
  gcBase = {
    small-read = {
      collectAt = 6;
      retain = 4;
      pressureFloor = 1;
      retireOnContextPressure = true;
    };
    small-write = {
      collectAt = 8;
      retain = 4;
      pressureFloor = 1;
      retireOnContextPressure = false;
    };
    standard-read = {
      collectAt = 8;
      retain = 4;
      pressureFloor = 1;
      retireOnContextPressure = true;
    };
    standard-write = {
      collectAt = 8;
      retain = 4;
      pressureFloor = 1;
      retireOnContextPressure = true;
    };
    advanced-read = {
      collectAt = 4;
      retain = 3;
      pressureFloor = 1;
      retireOnContextPressure = false;
    };
    advanced-write = {
      collectAt = 4;
      retain = 3;
      pressureFloor = 1;
      retireOnContextPressure = false;
    };
    research = {
      collectAt = 3;
      retain = 2;
      pressureFloor = 1;
      retireOnContextPressure = false;
    };
    perspective = {
      collectAt = 2;
      retain = 1;
      pressureFloor = 0;
      retireOnContextPressure = true;
    };
    search = {
      collectAt = 3;
      retain = 2;
      pressureFloor = 0;
      retireOnContextPressure = true;
    };
  };
  settledChildren = lib.mapAttrs (name: role:
    role
    // {
      execution = settledExecutions.${name};
      targets = settledChildTargets.${name} or [];
      gc = gcBase.${name};
    })
  settledRoles;
in
  delib.module {
    name = moduleName;
    options = with delib;
      moduleOptions ({parent, ...}: {
        enable = readOnly (boolOption (parent.enable && builtins.elem "orchestration" parent.defaultExtensions));
        extensionPaths = readOnly (listOfOption str [orchestrationExtension]);
        natureHandleWords = listOfOption str ["Coulson" "May" "Daisy" "Fitz" "Simmons" "Mack" "Elena" "Hunter" "Bobbi" "Deke" "Sousa" "Enoch"];
        commonChildExtensionContributions = listOfOption str [];
        children = attrsOfOption childType {};
        callPolicy = submoduleOption {
          options = with delib; {
            modes = attrsOfOption callerPolicyType {};
          };
        } {};
        budgets = attrsOfOption lib.types.int {};
        gc = submoduleOption {
          options = with delib; {
            contextHeadroomTokens = intOption 32768;
            periodicIntervalMs = intOption 5000;
            activityHeartbeatMs = intOption 2000;
            activityStaleMs = intOption 10000;
          };
        } {};
      });
    myconfig.always = {cfg, ...}: {
      args.shared.piOrchestration.enabled = cfg.enable;
      programs.pi-coding-agent.orchestration = {
        children = lib.mapAttrs (_: child: lib.mapAttrs (_: lib.mkDefault) child) settledChildren;
        callPolicy.modes = lib.mapAttrs (_: policy: {targets = lib.mkDefault policy.targets;}) settledCallPolicy.modes;
        budgets = lib.mapAttrs (_: lib.mkDefault) {
          maxLiveAgents = 12;
          maxConcurrentTasks = 12;
          maxTasksPerMesh = 64;
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
      modes = myconfig.programs.pi-coding-agent.mode.modes;
      childNames = builtins.attrNames cfg.children;
      cursorAcpModelIds = myconfig.programs.pi-coding-agent.cursorAcpModelIds;
      duplicates = values:
        builtins.filter
        (value: lib.count (candidate: candidate == value) values > 1)
        (lib.unique values);
      modeTargetLists =
        lib.mapAttrsToList (caller: policy: {
          label = "mode ${caller}";
          inherit caller;
          targets = policy.targets;
        })
        cfg.callPolicy.modes;
      childTargetLists =
        lib.mapAttrsToList (caller: child: {
          label = "child ${caller}";
          inherit caller;
          targets = child.targets;
        })
        cfg.children;
      allTargetLists = modeTargetLists ++ childTargetLists;
      duplicateTargets = lib.concatMap (entry: map (target: "${entry.label}: ${target}") (duplicates entry.targets)) allTargetLists;
      selectorKey = target:
        if !(builtins.hasAttr target cfg.children)
        then "unknown:${target}"
        else let
          selector = cfg.children.${target}.selector;
          agent =
            if builtins.isString selector.agent
            then selector.agent
            else "<invalid>";
        in "${agent}:${
          if selector.access == null
          then ""
          else selector.access
        }";
      ambiguousSelectors = lib.concatMap (entry: map (key: "${entry.caller}: ${key}") (duplicates (map selectorKey entry.targets))) allTargetLists;
      referencedChildren = lib.concatMap (entry: entry.targets) allTargetLists;
      unknownModes = builtins.filter (name: !(builtins.hasAttr name modes)) (builtins.attrNames cfg.callPolicy.modes);
      unknownChildTargets = builtins.filter (name: !(builtins.elem name childNames)) (lib.unique referencedChildren);
      outboundChildCallers = builtins.filter (name: cfg.children.${name}.targets != []) childNames;
      nonPiCallers = builtins.filter (name: cfg.children.${name}.execution.harness != "pi") outboundChildCallers;
      promptOnlyCallers = builtins.filter (name: cfg.children.${name}.contextPolicy == "prompt-only" && cfg.children.${name}.targets != []) childNames;
      promptOnlyNonPi = builtins.filter (name: cfg.children.${name}.contextPolicy == "prompt-only" && cfg.children.${name}.execution.harness != "pi") childNames;
      invalidSelectors = builtins.filter (name: let selector = cfg.children.${name}.selector; in !(builtins.isString selector.agent) || selector.agent == "") childNames;
      searchOnRoot = lib.concatMap (mode: map (target: "${mode}: ${target}") (builtins.filter (target: builtins.hasAttr target cfg.children && cfg.children.${target}.selector.agent == "search") cfg.callPolicy.modes.${mode}.targets)) (builtins.attrNames cfg.callPolicy.modes);
      searchFromNonResearch = lib.concatMap (caller: map (target: "${caller}: ${target}") (builtins.filter (target: builtins.hasAttr target cfg.children && cfg.children.${target}.selector.agent == "search") cfg.children.${caller}.targets)) (builtins.filter (caller: caller != "research") childNames);
      invalidChildModelLists = builtins.filter (name: let models = cfg.children.${name}.execution.models; in models == [] || duplicates models != []) childNames;
      invalidChildModelIdentifiers =
        lib.concatMap (
          name:
            builtins.filter (model: builtins.match "^[^/[:space:]]+/[^[:space:]]+$" model == null) cfg.children.${name}.execution.models
        )
        childNames;
      cursorReadHarnessOptions = {
        mode = "ask";
        permissionPolicy = "reject";
        sandbox = "disabled";
        trustWorkspace = true;
        worktree = false;
      };
      cursorWriteHarnessOptions = {
        mode = "agent";
        permissionPolicy = "allow-always";
        sandbox = "disabled";
        trustWorkspace = true;
        worktree = false;
      };
      codexHarnessOptions = {
        mode = "read-only";
        permissionPolicy = "reject";
        webSearch = "cached";
      };
      unmappedCursorChildren = builtins.filter (name: let
        execution = cfg.children.${name}.execution;
        alias =
          if execution.models == []
          then ""
          else lib.removePrefix "cursor/" (builtins.head execution.models);
      in
        execution.harness
        == "cursor-agent"
        && (execution.models == [] || !(builtins.hasAttr alias cursorAcpModelIds)))
      childNames;
      invalidChildHarnesses =
        builtins.filter (
          name: let
            execution = cfg.children.${name}.execution;
            hasSingletonModel = builtins.length execution.models == 1;
            model =
              if hasSingletonModel
              then builtins.head execution.models
              else "";
          in
            if execution.harness == "pi"
            then execution.thinkingLevel == null || execution.harnessOptions != {}
            else if execution.harness == "cursor-agent"
            then !hasSingletonModel || !(lib.hasPrefix "cursor/" model) || execution.thinkingLevel != null || !(execution.harnessOptions == cursorReadHarnessOptions || execution.harnessOptions == cursorWriteHarnessOptions)
            else !hasSingletonModel || !(lib.hasPrefix "codex/" model) || execution.thinkingLevel == null || execution.harnessOptions != codexHarnessOptions
        )
        childNames;
      isAbsoluteChildExtension = path: lib.hasPrefix "/" path;
      invalidCommonChildExtensions = builtins.filter (path: path == "" || !isAbsoluteChildExtension path) cfg.commonChildExtensionContributions;
      invalidPiChildExtensionContributions = lib.concatMap (name: let
        child = cfg.children.${name};
      in
        map (path: "${name}: ${path}") (builtins.filter (path: path == "" || !isAbsoluteChildExtension path) child.childExtensionContributions))
      (builtins.filter (name: cfg.children.${name}.execution.harness == "pi") childNames);
      effectiveChildExtensionContributions = child:
        if child.execution.harness == "pi"
        then lib.unique (cfg.commonChildExtensionContributions ++ child.childExtensionContributions)
        else child.childExtensionContributions;
      generatedChildren = lib.mapAttrs (_: child:
        child
        // {
          execution = cleanExecution child.execution;
          childExtensionContributions = effectiveChildExtensionContributions child;
        })
      cfg.children;
      names = values: lib.concatStringsSep ", " values;
    in {
      assertions = [
        {
          assertion = duplicateTargets == [];
          message = "Pi orchestration callPolicy and child target lists must be duplicate-free: ${names duplicateTargets}.";
        }
        {
          assertion = ambiguousSelectors == [];
          message = "Pi orchestration selectors must be unique for each caller: ${names ambiguousSelectors}.";
        }
        {
          assertion = invalidSelectors == [];
          message = "Pi orchestration children must define a non-empty selector agent: ${names invalidSelectors}.";
        }
        {
          assertion = unknownModes == [];
          message = "Pi orchestration callPolicy references unknown mode caller(s): ${names unknownModes}.";
        }
        {
          assertion = unknownChildTargets == [];
          message = "Pi orchestration callPolicy or child targets reference unknown child(ren): ${names unknownChildTargets}.";
        }
        {
          assertion = nonPiCallers == [];
          message = "Pi orchestration callers with outbound edges must execute only through Pi: ${names nonPiCallers}.";
        }
        {
          assertion = promptOnlyCallers == [];
          message = "Pi orchestration prompt-only children must be leaf callers: ${names promptOnlyCallers}.";
        }
        {
          assertion = promptOnlyNonPi == [];
          message = "Pi orchestration prompt-only children must execute only through Pi: ${names promptOnlyNonPi}.";
        }
        {
          assertion = invalidChildModelLists == [];
          message = "Pi orchestration children must have non-empty unique model lists: ${names invalidChildModelLists}.";
        }
        {
          assertion = invalidChildModelIdentifiers == [];
          message = "Pi orchestration child models must use provider/model format: ${names invalidChildModelIdentifiers}.";
        }
        {
          assertion = invalidChildHarnesses == [];
          message = "Pi orchestration children must satisfy their exact harness contract: ${names invalidChildHarnesses}.";
        }
        {
          assertion = unmappedCursorChildren == [];
          message = "Pi Cursor children require a cursorAcpModelIds entry: ${names unmappedCursorChildren}.";
        }
        {
          assertion = searchOnRoot == [];
          message = "Pi orchestration must not publish search on a root caller: ${names searchOnRoot}.";
        }
        {
          assertion = searchFromNonResearch == [];
          message = "Pi orchestration search must be reachable only from research: ${names searchFromNonResearch}.";
        }
        {
          assertion = invalidCommonChildExtensions == [];
          message = "Pi orchestration commonChildExtensionContributions must be non-empty absolute paths: ${names invalidCommonChildExtensions}.";
        }
        {
          assertion = invalidPiChildExtensionContributions == [];
          message = "Pi orchestration Pi childExtensionContributions must be non-empty absolute paths: ${names invalidPiChildExtensionContributions}.";
        }
      ];
      home.file = {
        "${myconfig.programs.pi-coding-agent.configDir}/child-catalog.json".text = builtins.toJSON {
          schemaVersion = 1;
          children = generatedChildren;
        };
        "${myconfig.programs.pi-coding-agent.configDir}/orchestration.json".text = builtins.toJSON {
          schemaVersion = 6;
          stateRoot = "${homeConfig.xdg.stateHome}/pi/orchestration-v11";
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
