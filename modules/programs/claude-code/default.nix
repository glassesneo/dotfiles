{
  delib,
  inputs,
  llm-agents,
  pkgs,
  ...
}:
delib.module {
  name = "programs.claude-code";

  options = delib.singleEnableOption true;

  home.ifEnabled = let
    # SketchyBar integration hook scripts
    sketchybarActiveScript =
      pkgs.writeShellScript "sketchybar-claude-active"
      (builtins.readFile
        (pkgs.replaceVars ./sketchybar-active.sh {
          jq = pkgs.lib.getExe pkgs.jq;
          sketchybar = pkgs.lib.getExe pkgs.sketchybar;
        }));

    sketchybarInactiveScript =
      pkgs.writeShellScript "sketchybar-claude-inactive"
      (builtins.readFile
        (pkgs.replaceVars ./sketchybar-inactive.sh {
          sketchybar = pkgs.lib.getExe pkgs.sketchybar;
        }));
  in {
    # Claude Code skill configuration
    programs.agent-skills = {
      enable = true;

      # Define skill sources
      sources = {
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
      };

      # Select skills for Claude Code
      skills = {
        enable = [
          "skill-creator"
        ];

        explicit = {
          ui-ux-pro-max = {
            from = "ui-ux-pro-max";
            path = ".claude/skills/ui-ux-pro-max";
          };
          sparze = {
            from = "sparze-source";
            path = ".";
          };
        };
      };

      # Deploy to Claude Code
      targets.claude = {
        dest = ".claude/skills";
        structure = "symlink-tree";
      };
    };

    programs.claude-code = {
      enable = true;
      package = llm-agents.claude-code;
      settings = {
        env = {
          DISABLE_AUTOUPDATER = "1";
          ENABLE_TOOL_SEARCH = true;
          ENABLE_LSP_TOOL = true;
        };
        # SketchyBar integration hooks - triggers status updates on prompt submit and stop
        hooks = {
          UserPromptSubmit = [
            {
              hooks = [
                {
                  type = "command";
                  command = toString sketchybarActiveScript;
                }
              ];
            }
          ];
          Stop = [
            {
              hooks = [
                {
                  type = "command";
                  command = toString sketchybarInactiveScript;
                }
              ];
            }
          ];
        };
      };
      memory.text = builtins.readFile ./GLOBAL_CLAUDE.md;
    };
  };
}
