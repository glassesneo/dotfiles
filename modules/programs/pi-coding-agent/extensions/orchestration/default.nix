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
  agentType = delib.submodule {
    options = with delib; {
      model = noDefault (strOption null);
      description = noDefault (strOption null);
      thinkingLevel = allowNull (enumOption ["off" "minimal" "low" "medium" "high" "xhigh" "max"] null);
      tools = listOfOption str [];
      skillOptIns = listOfOption str [];
      instructions = noDefault (strOption null);
      harness = enumOption ["pi" "cursor-agent" "codex"] "pi";
      harnessOptions = attrsOfOption lib.types.anything {};
      childExtensionContributions = listOfOption str [];
    };
  };
  settledAgents = {
    explorer = {
      model = "openai-codex/gpt-5.6-luna";
      description = "Read-only bounded repository evidence gathering.";
      thinkingLevel = "medium";
      tools = ["read" "grep" "find" "ls" "bash"];
      skillOptIns = ["codebase-exploration"];
      instructions = "Investigate one bounded repository question and return concise evidence with file references.";
      harness = "pi";
      harnessOptions = {};
      childExtensionContributions = [];
    };
    worker = {
      model = "openai-codex/gpt-5.6-sol";
      description = "Bounded source implementation and repair.";
      thinkingLevel = "medium";
      tools = ["read" "grep" "find" "ls" "bash" "write" "edit"];
      skillOptIns = ["source-implementation"];
      instructions = "Complete the bounded source objective, inspect the diff, and return changed files, diagnostics, deviations, and risks.";
      harness = "pi";
      harnessOptions = {};
      childExtensionContributions = [];
    };
    validator = {
      model = "openai-codex/gpt-5.6-luna";
      description = "Read-only automated implementation validation.";
      thinkingLevel = "medium";
      tools = ["read" "grep" "find" "ls" "bash"];
      skillOptIns = ["implementation-validation"];
      instructions = "Run the caller's requested automated validation objective without changing repository source and return concrete evidence.";
      harness = "pi";
      harnessOptions = {};
      childExtensionContributions = [];
    };
    reviewer = {
      model = "openai-codex/gpt-5.6-sol";
      description = "Read-only adaptive review owner with optional critic delegation.";
      thinkingLevel = "high";
      tools = ["read" "grep" "find" "ls" "bash" "mesh_enable" "mesh_run" "mesh_submit" "mesh_get" "mesh_wait" "mesh_stop" "mesh_route" "save_agent_artifact"];
      skillOptIns = ["adaptive-review" "task-orchestration" "agent-artifact"];
      instructions = "Review the defined target, delegate only a concrete independent critic lens when useful, and save one review report when requested.";
      harness = "pi";
      harnessOptions = {};
      childExtensionContributions = [artifactExtension];
    };
    critic = {
      model = "openai-codex/gpt-5.6-terra";
      description = "Read-only focused or dissenting review leaf.";
      thinkingLevel = "medium";
      tools = ["read" "grep" "find" "ls" "bash"];
      skillOptIns = [];
      instructions = "Review only the caller-supplied lens or dossier and return severity-ordered evidence, gaps, and residual risk.";
      harness = "pi";
      harnessOptions = {};
      childExtensionContributions = [];
    };
    fast-worker = {
      model = "cursor/cursor-grok-4.5-high-fast";
      description = "Fast bounded source worker through Cursor ACP; usage and interactive parity are limited.";
      thinkingLevel = null;
      tools = [];
      skillOptIns = [];
      instructions = "Implement the bounded source objective in the current workspace, validate proportionately, and return changed files, evidence, deviations, and risks.";
      harness = "cursor-agent";
      harnessOptions = {
        mode = "agent";
        permissionPolicy = "allow-always";
        sandbox = "disabled";
        trustWorkspace = true;
        worktree = false;
      };
      childExtensionContributions = [];
    };
    codex = {
      model = "codex/gpt-5.6-luna";
      description = "Read-only, source-backed Web research leaf through Codex ACP.";
      thinkingLevel = "high";
      tools = [];
      skillOptIns = [];
      instructions = "Use Codex's built-in Web search to investigate the delegated question. Return a concise evidence brief containing the conclusion, source URLs with the claim each supports, freshness, and material uncertainty. Read workspace context only when the task requires it. If evidence is insufficient, state what is missing.";
      harness = "codex";
      harnessOptions = {
        mode = "read-only";
        permissionPolicy = "reject";
        webSearch = "cached";
      };
      childExtensionContributions = [];
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
        agents = attrsOfOption agentType {};
        roleSets = attrsOfOption (lib.types.listOf lib.types.str) {};
        budgets = attrsOfOption lib.types.int {};
      });
    myconfig.always = {cfg, ...}: {
      programs.pi-coding-agent.orchestration = {
        agents = settledAgents;
        roleSets = {
          "mode:recon" = ["explorer" "reviewer" "critic" "codex"];
          "mode:ops" = ["explorer" "worker" "validator" "reviewer" "critic" "fast-worker" "codex"];
        };
        budgets = {
          maxLiveAgents = 12;
          maxConcurrentTasks = 6;
          maxTasksPerMesh = 256;
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
      names = builtins.attrNames cfg.agents;
      settledRoleSets = {
        "mode:recon" = ["explorer" "reviewer" "critic" "codex"];
        "mode:ops" = ["explorer" "worker" "validator" "reviewer" "critic" "fast-worker" "codex"];
      };
      settledBudgets = {
        maxLiveAgents = 12;
        maxConcurrentTasks = 6;
        maxTasksPerMesh = 256;
      };
      roleSetsValid = builtins.all (roles: lib.length roles == lib.length (lib.unique roles) && builtins.all (role: builtins.elem role names) roles) (builtins.attrValues cfg.roleSets);
      serialize = _: agent: lib.filterAttrs (name: value: value != null && !(name == "harnessOptions" && value == {})) agent;
    in {
      assertions = [
        {
          assertion = cfg.agents == settledAgents;
          message = "Pi orchestration catalog must exactly match the settled seven-agent models, instructions, tools, skills, thinking, harness options, and reviewer-owned artifact contribution.";
        }
        {
          assertion = cfg.roleSets == settledRoleSets && roleSetsValid && cfg.budgets == settledBudgets;
          message = "Pi orchestration role sets and mesh budgets must exactly match the settled recon and ops capabilities.";
        }
      ];
      home.file = {
        "${myconfig.programs.pi-coding-agent.configDir}/agent-catalog.json".text = builtins.toJSON {
          schemaVersion = 1;
          agents = lib.mapAttrs serialize cfg.agents;
        };
        "${myconfig.programs.pi-coding-agent.configDir}/orchestration.json".text = builtins.toJSON {
          schemaVersion = 1;
          stateRoot = "${homeConfig.xdg.stateHome}/pi/orchestration-v2";
          tmux = lib.getExe pkgs.tmux;
          returnParentCommand = lib.getExe returnParentCommand;
          inherit parentNavigationHint historyViewerExtension popupExtension orchestrationExtension childBridgeExtension;
          inherit (cfg) natureHandleWords roleSets budgets;
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
