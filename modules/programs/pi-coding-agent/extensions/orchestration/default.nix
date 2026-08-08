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
  parentKeys = piKeybindings.keysFor "subagentNavigation" "parent";
  parentTmuxKeys = map piKeybindings.toTmuxKey parentKeys;
  returnParentCommand = pkgs.writeShellApplication {
    name = "pi-subagent-return-parent";
    runtimeInputs = [pkgs.tmux pkgs.gnugrep];
    text = builtins.readFile ./return-parent.sh;
  };
  parentNavigationHint = "${tmux.prefix} ${lib.concatStringsSep "/" (map lib.toUpper parentTmuxKeys)}: parent · /parent";
  parentBinding = key: ''bind-key ${key} if-shell -F '#{==:#{@pi_subagent_schema},1}' 'run-shell "${lib.getExe returnParentCommand} --binding #{q:client_name} #{q:session_id} #{q:window_id}"' 'display-message "No subagent parent for this window"' '';
  agentType = delib.submodule {
    options = with delib; {
      model = noDefault (strOption null);
      description = noDefault (strOption null);
      thinkingLevel = allowNull (enumOption ["off" "minimal" "low" "medium" "high" "xhigh" "max"] null);
      tools = listOfOption str [];
      skillOptIns = listOfOption str [];
      instructions = noDefault (strOption null);
      harness = enumOption ["pi" "cursor-agent"] "pi";
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
      tools = ["read" "grep" "find" "ls" "bash" "subagent_run" "subagent_submit" "subagent_get" "subagent_wait" "subagent_stop" "save_agent_artifact"];
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
  };
in
  delib.module {
    name = moduleName;
    options = with delib;
      moduleOptions ({parent, ...}: {
        enable = readOnly (boolOption (parent.enable && builtins.elem "orchestration" parent.defaultExtensions));
        extensionPaths = readOnly (listOfOption str [orchestrationExtension]);
        maxDepth = intOption 3;
        natureHandleWords = listOfOption str ["Coulson" "May" "Daisy" "Fitz" "Simmons" "Mack" "Elena" "Hunter" "Bobbi" "Deke" "Sousa" "Enoch"];
        agents = attrsOfOption agentType {};
        delegation = attrsOfOption (lib.types.listOf lib.types.str) {};
      });
    myconfig.always = {cfg, ...}: {
      programs.pi-coding-agent.orchestration = {
        agents = settledAgents;
        delegation = {
          "mode:recon" = ["explorer" "reviewer"];
          "mode:ops" = ["explorer" "worker" "validator" "reviewer" "fast-worker"];
          "agent:reviewer" = ["critic"];
        };
      };
      programs.pi-coding-agent.keybindings.contributions = {
        subagentPalette = {
          enabled = cfg.enable;
          actions = {
            moveUp = {
              role = "moveUp";
              contexts = ["subagentPalette"];
              required = true;
              target = "extension";
            };
            moveDown = {
              role = "moveDown";
              contexts = ["subagentPalette"];
              required = true;
              target = "extension";
            };
            collapse = {
              role = "collapse";
              contexts = ["subagentPalette"];
              required = true;
              target = "extension";
            };
            expand = {
              role = "expand";
              contexts = ["subagentPalette"];
              required = true;
              target = "extension";
            };
            confirm = {
              role = "confirm";
              contexts = ["subagentPalette"];
              required = true;
              target = "extension";
            };
            cancel = {
              role = "cancel";
              contexts = ["subagentPalette"];
              required = true;
              target = "extension";
            };
            refresh = {
              defaultKeys = [];
              contexts = ["subagentPalette"];
              required = false;
              target = "extension";
            };
            stop = {
              defaultKeys = ["x"];
              contexts = ["subagentPalette"];
              required = false;
              target = "extension";
            };
            preview = {
              defaultKeys = ["space"];
              contexts = ["subagentPalette"];
              required = false;
              target = "extension";
            };
            unlink = {
              defaultKeys = [];
              contexts = ["subagentPalette"];
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
        subagentNavigation = {
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
    myconfig.ifEnabled.programs.tmux.extraConfigFragments.piSubagentParent = lib.concatMapStrings parentBinding parentTmuxKeys;
    home.ifEnabled = {
      cfg,
      myconfig,
      ...
    }: let
      names = builtins.attrNames cfg.agents;
      settledDelegation = {
        "mode:recon" = ["explorer" "reviewer"];
        "mode:ops" = ["explorer" "worker" "validator" "reviewer" "fast-worker"];
        "agent:reviewer" = ["critic"];
      };
      targetsValid = builtins.all (targets: lib.length targets == lib.length (lib.unique targets) && builtins.all (target: builtins.elem target names) targets) (builtins.attrValues cfg.delegation);
      serialize = _: agent: lib.filterAttrs (name: value: value != null && !(name == "harnessOptions" && value == {})) agent;
    in {
      assertions = [
        {
          assertion = cfg.maxDepth >= 0 && cfg.agents == settledAgents;
          message = "Pi orchestration catalog must exactly match the settled six-agent models, instructions, tools, skills, thinking, harness options, and reviewer-owned artifact contribution.";
        }
        {
          assertion = cfg.delegation == settledDelegation && targetsValid;
          message = "Pi orchestration delegation must exactly match the settled recon, ops, and reviewer caller map with known unique targets.";
        }
      ];
      home.file = {
        "${myconfig.programs.pi-coding-agent.configDir}/agent-catalog.json".text = builtins.toJSON {
          schemaVersion = 1;
          agents = lib.mapAttrs serialize cfg.agents;
        };
        "${myconfig.programs.pi-coding-agent.configDir}/orchestration.json".text = builtins.toJSON {
          schemaVersion = 1;
          stateRoot = "${homeConfig.xdg.stateHome}/pi/orchestration-v1";
          tmux = lib.getExe pkgs.tmux;
          returnParentCommand = lib.getExe returnParentCommand;
          inherit parentNavigationHint historyViewerExtension popupExtension orchestrationExtension childBridgeExtension;
          inherit (cfg) maxDepth natureHandleWords delegation;
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
          };
        };
      };
    };
  }
