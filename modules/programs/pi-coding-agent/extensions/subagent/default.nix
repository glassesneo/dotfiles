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
  moduleName = "programs.pi-coding-agent.subagent";
  profileExtension = "${./../../extensions_src}/profile.ts";
  subagentExtension = "${./../../extensions_src}/subagent.ts";
  agentArtifactExtension = "${./../../extensions_src}/agent_artifact.ts";
  childBridgeExtension = "${./../../extensions_src}/subagent_child_bridge.ts";
  historyViewerExtension = "${./../../extensions_src}/subagent_history_viewer.ts";
  externalWorkerEntrypoint = "${./../../extensions_src}/subagent_external_worker.ts";
  parentKeys = piKeybindings.keysFor "subagentNavigation" "parent";
  parentTmuxKeys = map piKeybindings.toTmuxKey parentKeys;
  returnParentCommand = pkgs.writeShellApplication {
    name = "pi-subagent-return-parent";
    runtimeInputs = [pkgs.tmux pkgs.gnugrep];
    text = builtins.readFile ./return-parent.sh;
  };
  parentNavigationHint = "${tmux.prefix} ${lib.concatStringsSep "/" (map lib.toUpper parentTmuxKeys)}: parent · /parent";
  parentBinding = key: ''
    bind-key ${key} if-shell -F '#{==:#{@pi_subagent_schema},1}' 'run-shell "${lib.getExe returnParentCommand} --binding #{q:client_name} #{q:session_id} #{q:window_id}"' 'display-message "No subagent parent for this window"'
  '';
in
  delib.module {
    name = moduleName;

    options = with delib;
      moduleOptions ({parent, ...}: {
        enable = readOnly (boolOption (parent.enable && builtins.elem "subagent" parent.defaultExtensions));
        extensionPaths = readOnly (listOfOption str [subagentExtension]);
        maxDepth = intOption 3;
        childExcludedTools = listOfOption str [];
        # Keep in sync with NATURE_HANDLE_WORDS in extensions_src/utilities/subagent_display_tree.ts
        natureHandleWords = listOfOption str [
          "Coulson"
          "May"
          "Daisy"
          "Fitz"
          "Simmons"
          "Mack"
          "Elena"
          "Hunter"
          "Bobbi"
          "Campbell"
          "Deke"
          "Sousa"
          "Trip"
          "Enoch"
          "Robbie"
          "Mace"
        ];
        childExtensionContributions = attrsOfOption (lib.types.listOf lib.types.str) {};
      });

    myconfig.always = {cfg, ...}: {
      programs.pi-coding-agent.profile.facetOwners.subagent = moduleName;
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

    myconfig.ifEnabled = {
      programs.tmux.extraConfigFragments.piSubagentParent = lib.concatMapStrings parentBinding parentTmuxKeys;
      programs.pi-coding-agent.profile.profiles = {
        full.extensions.subagent = {
          allowedTargets = ["scout" "taskmaster" "operator" "focused-reviewer" "tester" "reviewer" "explorer" "librarian"];
          harness = "pi";
        };
        taskmaster = {
          tools = ["subagent_run" "subagent_submit" "subagent_get" "subagent_wait" "subagent_stop"];
          extensions.subagent = {
            allowedTargets = ["tester" "reviewer" "focused-reviewer"];
            harness = "pi";
          };
        };
        artisan = {
          tools = ["subagent_run" "subagent_submit" "subagent_get" "subagent_wait" "subagent_stop"];
          extensions.subagent = {
            allowedTargets = ["reviewer"];
            harness = "pi";
          };
        };
        operator = {
          tools = ["subagent_run" "subagent_submit" "subagent_get" "subagent_wait" "subagent_stop"];
          extensions.subagent = {
            allowedTargets = ["explorer" "taskmaster" "cursor-implementer" "tester" "reviewer" "focused-reviewer" "librarian"];
            harness = "pi";
          };
        };
        cursor-implementer.extensions.subagent = {
          allowedTargets = [];
          harness = "cursor-agent";
          harnessOptions = {
            mode = "agent";
            permissionPolicy = "allow-always";
            sandbox = "disabled";
            trustWorkspace = true;
            worktree = false;
          };
        };
        tester.extensions.subagent = {
          allowedTargets = [];
          harness = "pi";
        };
        reviewer = {
          tools = ["subagent_run" "subagent_submit" "subagent_get" "subagent_wait" "subagent_stop"];
          extensions.subagent = {
            allowedTargets = ["focused-reviewer" "dissent-reviewer"];
            harness = "pi";
          };
        };
        scout = {
          tools = ["subagent_run" "subagent_submit" "subagent_get" "subagent_wait" "subagent_stop"];
          extensions.subagent = {
            allowedTargets = ["reviewer" "focused-reviewer" "explorer" "librarian"];
            harness = "pi";
          };
        };
        focused-reviewer.extensions.subagent = {
          allowedTargets = [];
          harness = "pi";
        };
        dissent-reviewer.extensions.subagent = {
          allowedTargets = [];
          harness = "pi";
        };
        explorer.extensions.subagent = {
          allowedTargets = [];
          harness = "pi";
        };
        librarian.extensions.subagent = {
          allowedTargets = [];
          harness = "pi";
        };
      };
    };

    home.always = {myconfig, ...}: let
      profiles = myconfig.programs.pi-coding-agent.profile.profiles;
      profileNames = builtins.attrNames profiles;
      runtimeWhitespace = map builtins.fromJSON [
        ''"\u0009"''
        ''"\u000a"''
        ''"\u000b"''
        ''"\u000c"''
        ''"\u000d"''
        ''"\u0020"''
        ''"\u00a0"''
        ''"\u1680"''
        ''"\u2000"''
        ''"\u2001"''
        ''"\u2002"''
        ''"\u2003"''
        ''"\u2004"''
        ''"\u2005"''
        ''"\u2006"''
        ''"\u2007"''
        ''"\u2008"''
        ''"\u2009"''
        ''"\u200a"''
        ''"\u2028"''
        ''"\u2029"''
        ''"\u202f"''
        ''"\u205f"''
        ''"\u3000"''
        ''"\ufeff"''
      ];
      nonBlank = value: builtins.replaceStrings runtimeWhitespace (map (_: "") runtimeWhitespace) value != "";
      validFacet = profile: let
        facet = profile.extensions.subagent or null;
        keys =
          if builtins.isAttrs facet
          then builtins.attrNames facet
          else [];
        targets =
          if builtins.isAttrs facet && facet ? allowedTargets
          then facet.allowedTargets
          else null;
        options =
          if builtins.isAttrs facet
          then facet.harnessOptions or null
          else null;
        cursorOptionsValid =
          builtins.isAttrs options
          && builtins.attrNames options == ["mode" "permissionPolicy" "sandbox" "trustWorkspace" "worktree"]
          && options.mode == "agent"
          && options.permissionPolicy == "allow-always"
          && options.sandbox == "disabled"
          && options.trustWorkspace == true
          && options.worktree == false;
      in
        facet
        == null
        || (
          builtins.isAttrs facet
          && builtins.all (key: builtins.elem key ["allowedTargets" "harness" "harnessOptions"]) keys
          && builtins.isList targets
          && facet ? harness
          && builtins.isString facet.harness
          && nonBlank facet.harness
          && builtins.elem facet.harness ["pi" "cursor-agent"]
          && (
            if facet.harness == "cursor-agent"
            then cursorOptionsValid
            else options == null
          )
          && (
            if facet.harness == "cursor-agent"
            then lib.hasPrefix "cursor/" profile.model && profile.tools == [] && !profile.allowAllTools && profile.thinkingLevel == null
            else true
          )
          && builtins.all (target: builtins.isString target && nonBlank target) targets
          && lib.length targets == lib.length (lib.unique targets)
          && builtins.all (target: builtins.elem target profileNames) targets
        );
      targetsAreRestrictive = profile: let
        facet = profile.extensions.subagent or null;
        targets =
          if builtins.isAttrs facet && facet ? allowedTargets
          then facet.allowedTargets
          else [];
      in
        builtins.all (
          target: !(profiles.${target}.allowAllTools) && builtins.elem "subagent" profiles.${target}.availability
        )
        targets;
    in {
      assertions = [
        {
          assertion = builtins.all validFacet (builtins.attrValues profiles);
          message = "Pi subagent profile facets must contain only unique existing allowedTargets and an available non-blank harness.";
        }
        {
          assertion = builtins.all targetsAreRestrictive (builtins.attrValues profiles);
          message = "Pi subagent allowedTargets must reference subagent-available restrictive profiles with explicit tool allowlists; allowAllTools targets are forbidden.";
        }
      ];
    };

    home.ifEnabled = {
      cfg,
      myconfig,
      ...
    }: let
      runtimeWhitespace = map builtins.fromJSON [
        ''"\u0009"''
        ''"\u000a"''
        ''"\u000b"''
        ''"\u000c"''
        ''"\u000d"''
        ''"\u0020"''
        ''"\u00a0"''
        ''"\u1680"''
        ''"\u2000"''
        ''"\u2001"''
        ''"\u2002"''
        ''"\u2003"''
        ''"\u2004"''
        ''"\u2005"''
        ''"\u2006"''
        ''"\u2007"''
        ''"\u2008"''
        ''"\u2009"''
        ''"\u200a"''
        ''"\u2028"''
        ''"\u2029"''
        ''"\u202f"''
        ''"\u205f"''
        ''"\u3000"''
        ''"\ufeff"''
      ];
      nonBlank = value: builtins.replaceStrings runtimeWhitespace (map (_: "") runtimeWhitespace) value != "";
      childExcludedTools = lib.unique cfg.childExcludedTools;
      natureHandleWords = lib.unique cfg.natureHandleWords;
      validNatureHandleWord = value: nonBlank value && !(lib.hasInfix "-" value);
      builtInChildExtensions = [profileExtension subagentExtension agentArtifactExtension childBridgeExtension];
      contributionOwners = lib.sort (a: b: a < b) (builtins.attrNames cfg.childExtensionContributions);
      contributedChildExtensions = lib.concatMap (owner: cfg.childExtensionContributions.${owner}) contributionOwners;
      childExtensions = builtInChildExtensions ++ contributedChildExtensions;
      contributionPathsValid =
        builtins.all nonBlank contributedChildExtensions
        && lib.length contributedChildExtensions == lib.length (lib.unique contributedChildExtensions)
        && builtins.all (path: !(builtins.elem path builtInChildExtensions)) contributedChildExtensions;
    in {
      assertions = [
        {
          assertion = cfg.maxDepth >= 0;
          message = "Pi subagent maxDepth must be non-negative.";
        }
        {
          assertion = builtins.all nonBlank cfg.childExcludedTools && lib.length cfg.childExcludedTools == lib.length childExcludedTools;
          message = "Pi subagent childExcludedTools must be unique non-blank tool names.";
        }
        {
          assertion =
            lib.length cfg.natureHandleWords
            > 0
            && builtins.all validNatureHandleWord cfg.natureHandleWords
            && lib.length cfg.natureHandleWords == lib.length natureHandleWords;
          message = "Pi subagent natureHandleWords must be a non-empty list of unique non-blank words without '-'.";
        }
        {
          assertion = contributionPathsValid;
          message = "Pi subagent childExtensionContributions must be unique non-blank paths that do not duplicate built-in child extensions.";
        }
      ];

      home.file."${myconfig.programs.pi-coding-agent.configDir}/subagent.json".text = builtins.toJSON {
        schemaVersion = 8;
        stateRoot = "${homeConfig.xdg.stateHome}/pi/subagents";
        tmux = lib.getExe pkgs.tmux;
        returnParentCommand = lib.getExe returnParentCommand;
        inherit parentNavigationHint historyViewerExtension;
        inherit childExtensions;
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
            # Cursor ACP cold start (process + initialize/authenticate + session/new) can exceed the Pi-native 5000 ms default.
            bridgeReadyTimeoutMs = 15000;
          };
        };
        inherit (cfg) maxDepth;
        inherit childExcludedTools;
        inherit (cfg) natureHandleWords;
      };
    };
  }
