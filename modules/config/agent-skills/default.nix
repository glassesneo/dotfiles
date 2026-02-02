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
    skills = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule {
        options = {
          path = lib.mkOption {
            type = lib.types.path;
            description = "Path to the skill source (flake input or derivation)";
          };

          subdir = lib.mkOption {
            type = lib.types.str;
            default = ".";
            description = "Subdirectory within the source path";
          };

          discoverable = lib.mkOption {
            type = lib.types.bool;
            default = true;
            description = ''
              Whether skill is auto-discoverable by name.
              - true: {path}/{subdir}/{skillName}
              - false: {path}/{subdir}/{explicitPath}
            '';
          };

          explicitPath = lib.mkOption {
            type = lib.types.nullOr lib.types.str;
            default = null;
            description = "Explicit path for non-discoverable skills. Required when discoverable = false.";
          };
        };
      });
      default = {};
      description = "All available skills with source paths and metadata";
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
    agentSkills.skills = {
      skill-creator = {
        path = inputs.anthropic-skills;
        subdir = ".";
        discoverable = true;
      };

      ui-ux-pro-max = {
        path = inputs.ui-ux-pro-max;
        subdir = ".";
        discoverable = false;
        explicitPath = ".claude/skills/ui-ux-pro-max";
      };

      tmux-runner = {
        path = ./tmux-runner;
        subdir = ".";
        discoverable = false;
        explicitPath = ".";
      };

      codex-subagent = {
        path = ./codex-subagent;
        subdir = ".";
        discoverable = false;
        explicitPath = ".";
      };

      codex-exec = {
        path = ./codex-exec;
        subdir = ".";
        discoverable = false;
        explicitPath = ".";
      };

      sparze = {
        path = inputs.sparze;
        subdir = ".";
        discoverable = false;
        explicitPath = ".";
      };

      agent-browser = {
        path = "${llm-agents.agent-browser}/etc/agent-browser/skills";
        subdir = ".";
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

          # Determine link path based on discoverable flag
          linkPath =
            if skill.discoverable
            then "${skill.path}/${skill.subdir}/${skillName}"
            else "${skill.path}/${skill.subdir}/${skill.explicitPath}";

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
