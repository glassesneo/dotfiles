{
  delib,
  homeConfig,
  host,
  lib,
  llm-agents,
  pkgs,
  ...
}: let
  configDir = "${homeConfig.home.homeDirectory}/.pi/agent";
  scoutTools = ["read" "grep" "find" "ls" "subagent_start" "subagent_get" "subagent_wait"];
  profileType = delib.submodule {
    options = with delib; {
      harness = enumOption ["pi"] "pi";
      model = noDefault (strOption null);
      thinkingLevel = allowNull (enumOption ["off" "minimal" "low" "medium" "high" "xhigh" "max"] null);
      allowAllTools = boolOption false;
      tools = listOfOption str [];
      allowedSubagents = listOfOption str [];
      instructions = allowNull (strOption null);
    };
  };
in
  delib.module {
    name = "programs.pi-coding-agent.subagent";

    options = with delib;
      moduleOptions ({myconfig, ...}: {
        enable = boolOption (host.type == "virtual" && myconfig.programs.pi-coding-agent.enable);
        defaultProfile = strOption "full";
        profileCycle = listOfOption str ["scout" "full"];
        maxDepth = intOption 3;
        profiles = attrsOfOption profileType {
          scout = {
            harness = "pi";
            model = "openai-codex/gpt-5.6-sol";
            thinkingLevel = "low";
            allowAllTools = false;
            tools = scoutTools;
            allowedSubagents = ["scout"];
          };
          full = {
            harness = "pi";
            model = "openai-codex/gpt-5.6-sol";
            thinkingLevel = "medium";
            allowAllTools = true;
            tools = [];
            allowedSubagents = ["scout" "full"];
          };
        };
      });

    home.ifEnabled = {cfg, ...}:
      lib.mkIf (host.type == "virtual") (let
        cleanProfile = profile: lib.filterAttrs (_: value: value != null) profile;
        profileNames = builtins.attrNames cfg.profiles;
        referencesExist = names: builtins.all (name: builtins.elem name profileNames) names;
        runtimeConfig = {
          schemaVersion = 2;
          stateRoot = "${homeConfig.xdg.stateHome}/pi/subagents/runs";
          runner = {
            node = lib.getExe pkgs.nodejs;
            script = "${./../../extensions_src}/subagent_runner.ts";
            extension = "${./../../extensions_src}/subagent.ts";
          };
          harnesses.pi.command = lib.getExe llm-agents.pi;
          inherit (cfg) defaultProfile profileCycle maxDepth;
          profiles = lib.mapAttrs (_: cleanProfile) cfg.profiles;
        };
      in {
        assertions = [
          {
            assertion = cfg.maxDepth >= 0;
            message = "Pi agent profile maxDepth must be non-negative.";
          }
          {
            assertion = builtins.elem cfg.defaultProfile profileNames;
            message = "Pi defaultProfile must reference an existing profile.";
          }
          {
            assertion = lib.length cfg.profileCycle == lib.length (lib.unique cfg.profileCycle) && referencesExist cfg.profileCycle;
            message = "Pi profileCycle must contain unique existing profile names.";
          }
          {
            assertion = builtins.all (name: name != "") profileNames;
            message = "Pi agent profile names must not be empty.";
          }
          {
            assertion = builtins.all (profile: referencesExist profile.allowedSubagents) (builtins.attrValues cfg.profiles);
            message = "Pi allowedSubagents must reference existing profiles.";
          }
          {
            assertion = builtins.all (profile: !(profile.allowAllTools && profile.tools != [])) (builtins.attrValues cfg.profiles);
            message = "Pi profiles with allowAllTools enabled must not also declare tools.";
          }
        ];

        programs.pi-coding-agent.settings.extensions = [
          "${./../../extensions_src}/subagent.ts"
        ];

        home.file."${configDir}/agent-profiles.json".text = builtins.toJSON runtimeConfig;
      });
  }
