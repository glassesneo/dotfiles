{
  delib,
  lib,
  ...
}: let
  moduleName = "programs.pi-coding-agent.profile";
  profileType = delib.submodule {
    options = with delib; {
      model = noDefault (strOption null);
      description = noDefault (strOption null);
      thinkingLevel = allowNull (enumOption ["off" "minimal" "low" "medium" "high" "xhigh" "max"] null);
      allowAllTools = boolOption false;
      tools = listOfOption str [];
      instructions = allowNull (strOption null);
      extensions = attrsOfOption attrs {};
    };
  };
  cleanProfile = profile: lib.filterAttrs (_: value: value != null) profile;
in
  delib.module {
    name = moduleName;

    options = with delib;
      moduleOptions ({parent, ...}: {
        enable = readOnly (boolOption (parent.enable && builtins.elem "profile" parent.defaultExtensions));
        extensionPaths = readOnly (listOfOption str ["${./../../extensions_src}/profile.ts"]);
        defaultProfile = strOption "full";
        profileCycle = listOfOption str ["full" "taskmaster" "scout"];
        defaultTools = listOfOption str [];
        profiles = attrsOfOption profileType {};
        facetOwners = attrsOfOption str {};
      });

    myconfig.always.programs.pi-coding-agent.profile = {
      defaultTools = ["read" "grep" "find" "ls" "bash"];
      profiles = {
        full = {
          model = "openai-codex/gpt-5.6-sol";
          description = "Use for work that needs broad coding capability.";
          thinkingLevel = "medium";
          allowAllTools = true;
          tools = [];
          extensions = {};
        };
        taskmaster = {
          model = "openai-codex/gpt-5.6-sol";
          description = "Use for work that needs broad coding capability; include the deliverable, constraints, and verification conditions in the delegated prompt.";
          thinkingLevel = "medium";
          allowAllTools = false;
          tools = ["write" "edit"];
          extensions = {};
        };
        scout = {
          model = "openai-codex/gpt-5.6-sol";
          description = "Use for read-only exploration and evidence gathering.";
          thinkingLevel = "high";
          allowAllTools = false;
          tools = [];
          extensions = {};
        };
        focused-reviewer = {
          model = "openai-codex/gpt-5.6-terra";
          description = "Use for a read-only review limited to a caller-specified lens; include the lens, review target, and higher-level design or implementation report in the delegated prompt.";
          thinkingLevel = "medium";
          allowAllTools = false;
          tools = [];
          extensions = {};
        };
      };
    };

    home.ifEnabled = {
      cfg,
      myconfig,
      ...
    }: let
      profileNames = builtins.attrNames cfg.profiles;
      profiles = builtins.attrValues cfg.profiles;
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
      referencesExist = names: builtins.all (name: builtins.elem name profileNames) names;
      knownFacets = builtins.attrNames cfg.facetOwners;
      profileFacetsKnown = profile:
        builtins.all (facet: builtins.elem facet knownFacets) (builtins.attrNames profile.extensions);
      modelValid = profile: builtins.match "[^/[:space:]]+/[^/[:space:]]+" profile.model != null;
      descriptionValid = profile: nonBlank profile.description && builtins.stringLength profile.description <= 512;
      toolsValid = profile:
        builtins.all nonBlank (
          if profile.allowAllTools
          then profile.tools
          else cfg.defaultTools ++ profile.tools
        );
      instructionsValid = profile: profile.instructions == null || nonBlank profile.instructions;
      serializeProfile = profile:
        cleanProfile (
          if profile.allowAllTools
          then profile
          else profile // {tools = lib.unique (cfg.defaultTools ++ profile.tools);}
        );
      runtimeConfig = {
        schemaVersion = 2;
        inherit (cfg) defaultProfile profileCycle;
        profiles = lib.mapAttrs (_: serializeProfile) cfg.profiles;
      };
    in {
      assertions = [
        {
          assertion = builtins.elem cfg.defaultProfile profileNames;
          message = "Pi defaultProfile must reference an existing profile.";
        }
        {
          assertion = cfg.profileCycle != [] && lib.length cfg.profileCycle == lib.length (lib.unique cfg.profileCycle) && referencesExist cfg.profileCycle;
          message = "Pi profileCycle must contain one or more unique existing profile names.";
        }
        {
          assertion = builtins.all nonBlank profileNames;
          message = "Pi agent profile names must be non-blank.";
        }
        {
          assertion = builtins.all modelValid profiles;
          message = "Pi profile models must use provider/model format.";
        }
        {
          assertion = builtins.all descriptionValid profiles;
          message = "Pi profile descriptions must be non-blank and at most 512 UTF-8 bytes.";
        }
        {
          assertion = builtins.all toolsValid profiles;
          message = "Pi profile tools must be non-blank.";
        }
        {
          assertion = builtins.all instructionsValid profiles;
          message = "Pi profile instructions must be null or non-blank.";
        }
        {
          assertion = builtins.all (profile: !(profile.allowAllTools && profile.tools != [])) profiles;
          message = "Pi profiles with allowAllTools enabled must not also declare tools.";
        }
        {
          assertion = builtins.all profileFacetsKnown profiles;
          message = "Pi profile extension facets must have a registered facet owner.";
        }
      ];

      home.file."${myconfig.programs.pi-coding-agent.configDir}/agent-profiles.json".text = builtins.toJSON runtimeConfig;
    };
  }
