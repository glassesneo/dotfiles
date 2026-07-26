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
  builtinTools = ["read" "bash" "edit" "write" "grep" "find" "ls"];
  profileType = delib.submodule {
    options = with delib; {
      harness = enumOption ["pi"] "pi";
      model = noDefault (strOption null);
      thinkingLevel = allowNull (enumOption ["off" "minimal" "low" "medium" "high" "xhigh" "max"] null);
      tools = listOfOption str builtinTools;
    };
  };
in
  delib.module {
    name = "programs.pi-coding-agent.subagent";

    options = with delib;
      moduleOptions ({myconfig, ...}: {
        enable = boolOption (host.type == "virtual" && myconfig.programs.pi-coding-agent.enable);
        profiles = attrsOfOption profileType {
          scout = {
            harness = "pi";
            model = "openai-codex/gpt-5.6-sol";
            thinkingLevel = "low";
            tools = ["read" "grep" "find" "ls"];
          };
          coding = {
            harness = "pi";
            model = "openai-codex/gpt-5.6-sol";
            thinkingLevel = "medium";
            tools = builtinTools;
          };
        };
      });

    home.ifEnabled = {cfg, ...}:
      lib.mkIf (host.type == "virtual") (let
        cleanProfile = profile: lib.filterAttrs (_: value: value != null) profile;
        runtimeConfig = {
          schemaVersion = 1;
          stateRoot = "${homeConfig.xdg.stateHome}/pi/subagents/runs";
          runner = {
            node = lib.getExe pkgs.nodejs;
            script = "${./../../extensions_src}/subagent_runner.ts";
          };
          harnesses.pi.command = lib.getExe llm-agents.pi;
          profiles = lib.mapAttrs (_: cleanProfile) cfg.profiles;
        };
      in {
        programs.pi-coding-agent.settings.extensions = [
          "${./../../extensions_src}/subagent.ts"
        ];

        home.file."${configDir}/subagent-profiles.json".text = builtins.toJSON runtimeConfig;
      });
  }
