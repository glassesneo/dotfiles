{
  delib,
  homeConfig,
  lib,
  ...
}: let
  moduleName = "programs.pi-coding-agent.profile";
  configDir = "${homeConfig.home.homeDirectory}/.pi/agent";
  profileType = delib.submodule {
    options = with delib; {
      model = noDefault (strOption null);
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
        extensionPaths = readOnly (listOfOption str ["${./extensions_src}/profile.ts"]);
        defaultProfile = strOption "full";
        profileCycle = listOfOption str ["scout" "full"];
        profiles = attrsOfOption profileType {};
        facetOwners = attrsOfOption str {};
      });

    myconfig.always.programs.pi-coding-agent.profile.profiles = {
      scout = {
        model = "openai-codex/gpt-5.6-sol";
        thinkingLevel = "low";
        allowAllTools = false;
        tools = ["read" "grep" "find" "ls"];
        extensions = {};
      };
      full = {
        model = "openai-codex/gpt-5.6-sol";
        thinkingLevel = "medium";
        allowAllTools = true;
        tools = [];
        extensions = {};
      };
    };

    home.ifEnabled = {cfg, ...}: let
      profileNames = builtins.attrNames cfg.profiles;
      referencesExist = names: builtins.all (name: builtins.elem name profileNames) names;
      knownFacets = builtins.attrNames cfg.facetOwners;
      profileFacetsKnown = profile:
        builtins.all (facet: builtins.elem facet knownFacets) (builtins.attrNames profile.extensions);
      modelValid = profile: builtins.match "[^/[:space:]]+/[^/[:space:]]+" profile.model != null;
      runtimeConfig = {
        schemaVersion = 1;
        inherit (cfg) defaultProfile profileCycle;
        profiles = lib.mapAttrs (_: cleanProfile) cfg.profiles;
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
          assertion = builtins.all (name: name != "") profileNames;
          message = "Pi agent profile names must not be empty.";
        }
        {
          assertion = builtins.all modelValid (builtins.attrValues cfg.profiles);
          message = "Pi profile models must use provider/model format.";
        }
        {
          assertion = builtins.all (profile: !(profile.allowAllTools && profile.tools != [])) (builtins.attrValues cfg.profiles);
          message = "Pi profiles with allowAllTools enabled must not also declare tools.";
        }
        {
          assertion = builtins.all profileFacetsKnown (builtins.attrValues cfg.profiles);
          message = "Pi profile extension facets must have a registered facet owner.";
        }
      ];

      home.file."${configDir}/agent-profiles.json".text = builtins.toJSON runtimeConfig;
    };
  }
