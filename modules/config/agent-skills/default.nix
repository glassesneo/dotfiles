{
  delib,
  homeConfig,
  inputs,
  lib,
  llm-agents,
  pkgs,
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
            type = lib.types.enum ["symlink-tree" "copy"];
            default = "symlink-tree";
            description = ''
              Deployment structure:
              - symlink-tree: Creates symlinks (default, works for Claude Code)
              - copy: Copies files (required for Codex which doesn't follow symlinks)
            '';
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
        subdir = "skills";
        discoverable = true;
      };

      ui-ux-pro-max = {
        path = inputs.ui-ux-pro-max;
        subdir = ".";
        discoverable = false;
        explicitPath = ".claude/skills/ui-ux-pro-max";
      };

      hierarchical-claude-md = {
        path = ./hierarchical-claude-md;
        subdir = ".";
        discoverable = false;
        explicitPath = ".";
      };

      ai-first-doccomments = {
        path = ./ai-first-doccomments;
        subdir = ".";
        discoverable = false;
        explicitPath = ".";
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
    # Helper to get skill source path
    getSkillPath = skillName: let
      skill = myconfig.agentSkills.skills.${skillName};
    in
      if skill.discoverable
      then "${skill.path}/${skill.subdir}/${skillName}"
      else "${skill.path}/${skill.subdir}/${skill.explicitPath}";

    # Generate symlinks for agents using symlink-tree structure
    mkSkillLinks = agentName: agentConfig:
      if agentConfig.structure == "symlink-tree"
      then
        lib.listToAttrs (map (skillName: {
            name = "${agentConfig.targetDir}/${skillName}";
            value = {
              source = getSkillPath skillName;
              recursive = true;
            };
          })
          agentConfig.skills)
      else {};

    # Generate all skill links for symlink-tree agents
    allSkillLinks = lib.foldl' (
      acc: agentName:
        acc // (mkSkillLinks agentName myconfig.agentSkills.agents.${agentName})
    ) {} (lib.attrNames myconfig.agentSkills.agents);

    # Generate activation script for copy-mode agents
    copyAgents = lib.filterAttrs (_: cfg: cfg.structure == "copy") myconfig.agentSkills.agents;
    copyScript = lib.concatStringsSep "\n" (lib.mapAttrsToList (agentName: agentConfig: let
        targetDir = "${homeConfig.home.homeDirectory}/${agentConfig.targetDir}";
        copyCommands = lib.concatStringsSep "\n" (map (skillName: let
            src = getSkillPath skillName;
            dest = "${targetDir}/${skillName}";
          in ''
            # Copy ${skillName} for ${agentName}
            rm -rf "${dest}"
            mkdir -p "${dest}"
            cp -rL "${src}/." "${dest}/"
            chmod -R u+w "${dest}"
          '')
          agentConfig.skills);
      in ''
        # Setup skills for ${agentName} (copy mode)
        mkdir -p "${targetDir}"
        ${copyCommands}
      '')
      copyAgents);
  in {
    home.file = allSkillLinks;

    # Activation script for copy-mode agents (e.g., Codex)
    home.activation.copyAgentSkills = lib.mkIf (copyAgents != {}) (
      lib.hm.dag.entryAfter ["writeBoundary"] ''
        run ${pkgs.writeShellScript "copy-agent-skills" copyScript}
      ''
    );
  };
}
