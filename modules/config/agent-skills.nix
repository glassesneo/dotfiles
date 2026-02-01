{
  delib,
  inputs,
  lib,
  llm-agents,
  ...
}:
delib.module {
  name = "agentSkills";

  options.agentSkills = {
    sources = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule {
        options = {
          path = lib.mkOption {
            type = lib.types.path;
            description = "Path to the skill source";
          };
          subdir = lib.mkOption {
            type = lib.types.str;
            default = ".";
            description = "Subdirectory within the source";
          };
        };
      });
      default = {};
      description = "All available skill sources";
    };

    skills = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule {
        options = {
          source = lib.mkOption {
            type = lib.types.str;
            description = "Source name from agentSkills.sources";
          };
          discoverable = lib.mkOption {
            type = lib.types.bool;
            default = true;
            description = "Whether skill is auto-discoverable or needs explicit path";
          };
          explicitPath = lib.mkOption {
            type = lib.types.nullOr lib.types.str;
            default = null;
            description = "Explicit deployment path for non-discoverable skills";
          };
        };
      });
      default = {};
      description = "All available skills with metadata";
    };

    agents = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule {
        options = {
          skills = lib.mkOption {
            type = lib.types.listOf lib.types.str;
            default = [];
            description = "List of skill names to enable for this agent";
          };
          targetDir = lib.mkOption {
            type = lib.types.str;
            description = "Target directory for skill deployment";
          };
          structure = lib.mkOption {
            type = lib.types.str;
            default = "symlink-tree";
            description = "Deployment structure (symlink-tree or flat)";
          };
        };
      });
      default = {};
      description = "Per-agent skill assignments";
    };
  };

  myconfig.always = {
    # All sources defined once
    agentSkills.sources = {
      anthropic = {
        path = inputs.anthropic-skills;
        subdir = ".";
      };
      ui-ux-pro-max = {
        path = inputs.ui-ux-pro-max;
        subdir = ".";
      };
      sparze-source = {
        path = inputs.sparze;
        subdir = ".";
      };
      agent-browser = {
        path = "${llm-agents.agent-browser}/etc/agent-browser/skills";
        subdir = ".";
      };
    };

    # All skills with metadata
    agentSkills.skills = {
      skill-creator = {
        source = "anthropic";
        discoverable = true;
      };
      ui-ux-pro-max = {
        source = "ui-ux-pro-max";
        discoverable = false;
        explicitPath = ".claude/skills/ui-ux-pro-max";
      };
      sparze = {
        source = "sparze-source";
        discoverable = false;
        explicitPath = ".";
      };
      agent-browser = {
        source = "agent-browser";
        discoverable = true;
      };
    };
  };

  home.always = {myconfig, ...}: let
    # Generate symlinks for each agent's skills directly via home.file
    # This replaces the agent-skills module which doesn't support per-target filtering
    mkSkillLinks = agentName: agentConfig: let
      skillsList = agentConfig.skills;
      targetDir = agentConfig.targetDir;

      # Create symlink for each skill
      skillLinks = lib.listToAttrs (map (skillName: let
          skill = myconfig.agentSkills.skills.${skillName};
          source = myconfig.agentSkills.sources.${skill.source};

          # Determine the link path
          linkPath =
            if skill.discoverable
            then "${source.path}/${source.subdir}/${skillName}"
            else "${source.path}/${source.subdir}/${skill.explicitPath}";

          # Create unique attribute name for home.file
          attrName = "${targetDir}/${skillName}";
        in {
          name = attrName;
          value = {
            source = linkPath;
            recursive = true;
          };
        })
        skillsList);
    in
      skillLinks;

    # Generate all skill links for all agents
    allSkillLinks = lib.foldl' (
      acc: agentName:
        acc // (mkSkillLinks agentName myconfig.agentSkills.agents.${agentName})
    ) {} (lib.attrNames myconfig.agentSkills.agents);
  in {
    home.file = allSkillLinks;
  };
}
