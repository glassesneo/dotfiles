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
in
  delib.module {
    name = moduleName;

    options = with delib;
      moduleOptions ({myconfig, ...}: {
        enable = boolOption myconfig.programs.pi-coding-agent.enable;
        maxDepth = intOption 3;
      });

    myconfig.always.programs.pi-coding-agent.profile.facetOwners.subagent = moduleName;

    myconfig.ifEnabled.programs.pi-coding-agent.profile.profiles = {
      full.extensions.subagent = {
        allowedTargets = ["scout" "taskmaster" "focused-reviewer"];
        harness = "pi";
      };
      taskmaster = {
        tools = ["subagent_start" "subagent_get" "subagent_wait" "subagent_stop"];
        extensions.subagent = {
          allowedTargets = ["focused-reviewer"];
          harness = "pi";
        };
      };
      scout = {
        tools = ["subagent_start" "subagent_get" "subagent_wait" "subagent_stop"];
        extensions.subagent = {
          allowedTargets = ["focused-reviewer"];
          harness = "pi";
        };
      };
      focused-reviewer.extensions.subagent = {
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
    in {
      assertions = [
        {
          assertion = builtins.all validFacet (builtins.attrValues profiles);
          message = "Pi subagent profile facets must contain only unique existing allowedTargets and an available non-blank harness.";
        }
      ];
    };

    home.ifEnabled = {
      cfg,
      myconfig,
      ...
    }: {
      assertions = [
        {
          assertion = cfg.maxDepth >= 0;
          message = "Pi subagent maxDepth must be non-negative.";
        }
      ];

      programs.pi-coding-agent.settings.extensions = [subagentExtension];

      home.file."${myconfig.programs.pi-coding-agent.configDir}/subagent.json".text = builtins.toJSON {
        schemaVersion = 2;
        stateRoot = "${homeConfig.xdg.stateHome}/pi/subagents/runs";
        runner = {
          node = lib.getExe pkgs.nodejs;
          script = "${./../../extensions_src}/subagent_runner.ts";
          supervisor = "${./../../extensions_src}/subagent_supervisor.ts";
          viewer = "${./../../extensions_src}/subagent_viewer.ts";
          less = lib.getExe pkgs.less;
          extensions = [profileExtension subagentExtension];
        };
        harnesses.pi.command = lib.getExe llm-agents.pi;
        inherit (cfg) maxDepth;
      };
    };
  }
