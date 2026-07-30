{
  delib,
  homeConfig,
  lib,
  llm-agents,
  pkgs,
  ...
}: let
  moduleName = "programs.pi-coding-agent.subagent";
  profileExtension = "${./../../extensions_src}/profile.ts";
  subagentExtension = "${./../../extensions_src}/subagent.ts";
  agentArtifactExtension = "${./../../extensions_src}/agent_artifact.ts";
  childBridgeExtension = "${./../../extensions_src}/subagent_child_bridge.ts";
  historyViewerExtension = "${./../../extensions_src}/subagent_history_viewer.ts";
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
      });

    myconfig.always.programs.pi-coding-agent.profile.facetOwners.subagent = moduleName;

    myconfig.ifEnabled.programs.pi-coding-agent.profile.profiles = {
      full.extensions.subagent = {
        allowedTargets = ["scout" "taskmaster" "focused-reviewer" "tester" "review-orchestrator"];
        harness = "pi";
      };
      taskmaster = {
        tools = ["subagent_start" "subagent_send" "subagent_get" "subagent_wait" "subagent_stop"];
        extensions.subagent = {
          allowedTargets = ["tester" "review-orchestrator" "focused-reviewer"];
          harness = "pi";
        };
      };
      tester.extensions.subagent = {
        allowedTargets = [];
        harness = "pi";
      };
      review-orchestrator = {
        tools = ["subagent_start" "subagent_send" "subagent_get" "subagent_wait" "subagent_stop"];
        extensions.subagent = {
          allowedTargets = ["focused-reviewer" "dissent-reviewer"];
          harness = "pi";
        };
      };
      scout = {
        tools = ["subagent_start" "subagent_send" "subagent_get" "subagent_wait" "subagent_stop"];
        extensions.subagent = {
          allowedTargets = ["review-orchestrator" "focused-reviewer"];
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
      in
        facet
        == null
        || (
          builtins.isAttrs facet
          && builtins.all (key: builtins.elem key ["allowedTargets" "harness"]) keys
          && builtins.isList targets
          && facet ? harness
          && builtins.isString facet.harness
          && nonBlank facet.harness
          && builtins.elem facet.harness ["pi"]
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
          target: !(profiles.${target}.allowAllTools)
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
          message = "Pi subagent allowedTargets must reference restrictive profiles with explicit tool allowlists; allowAllTools targets are forbidden.";
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
      ];

      home.file."${myconfig.programs.pi-coding-agent.configDir}/subagent.json".text = builtins.toJSON {
        schemaVersion = 6;
        stateRoot = "${homeConfig.xdg.stateHome}/pi/subagents";
        tmux = lib.getExe pkgs.tmux;
        inherit historyViewerExtension;
        childExtensions = [profileExtension subagentExtension agentArtifactExtension childBridgeExtension];
        harnesses.pi.command = lib.getExe llm-agents.pi;
        inherit (cfg) maxDepth;
        inherit childExcludedTools;
        inherit (cfg) natureHandleWords;
      };
    };
  }
