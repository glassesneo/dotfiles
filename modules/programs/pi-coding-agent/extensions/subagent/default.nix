{
  delib,
  homeConfig,
  host,
  lib,
  llm-agents,
  pkgs,
  ...
}: let
  moduleName = "programs.pi-coding-agent.subagent";
  configDir = "${homeConfig.home.homeDirectory}/.pi/agent";
  profileExtension = "${./../../extensions_src}/profile.ts";
  subagentExtension = "${./../../extensions_src}/subagent.ts";
in
  delib.module {
    name = moduleName;

    options = with delib;
      moduleOptions ({myconfig, ...}: {
        enable = boolOption (host.type == "virtual" && myconfig.programs.pi-coding-agent.enable);
        maxDepth = intOption 3;
      });

    myconfig.always.programs.pi-coding-agent.profile.facetOwners.subagent = moduleName;

    myconfig.ifEnabled.programs.pi-coding-agent.profile.profiles = {
      full.extensions.subagent.allowedTargets = ["scout" "full" "focused-reviewer"];
      scout = {
        tools = ["subagent_start" "subagent_get" "subagent_wait" "subagent_stop"];
        extensions.subagent.allowedTargets = ["scout" "focused-reviewer"];
      };
    };

    home.always = {myconfig, ...}: let
      profiles = myconfig.programs.pi-coding-agent.profile.profiles;
      profileNames = builtins.attrNames profiles;
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
          && builtins.all (key: key == "allowedTargets") keys
          && builtins.isList targets
          && builtins.all (target: builtins.isString target && target != "") targets
          && lib.length targets == lib.length (lib.unique targets)
          && builtins.all (target: builtins.elem target profileNames) targets
        );
    in {
      assertions = [
        {
          assertion = builtins.all validFacet (builtins.attrValues profiles);
          message = "Pi subagent profile facets must contain only unique existing allowedTargets.";
        }
      ];
    };

    home.ifEnabled = {cfg, ...}: {
      assertions = [
        {
          assertion = cfg.maxDepth >= 0;
          message = "Pi subagent maxDepth must be non-negative.";
        }
      ];

      programs.pi-coding-agent.settings.extensions = [subagentExtension];

      home.file."${configDir}/subagent.json".text = builtins.toJSON {
        schemaVersion = 1;
        stateRoot = "${homeConfig.xdg.stateHome}/pi/subagents/runs";
        runner = {
          node = lib.getExe pkgs.nodejs;
          script = "${./../../extensions_src}/subagent_runner.ts";
          extensions = [profileExtension subagentExtension];
        };
        harnesses.pi.command = lib.getExe llm-agents.pi;
        inherit (cfg) maxDepth;
      };
    };
  }
