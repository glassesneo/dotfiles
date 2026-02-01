{
  delib,
  llm-agents,
  pkgs,
  ...
}:
delib.module {
  name = "programs.claude-code";

  options = delib.singleEnableOption true;

  myconfig.ifEnabled = {
    agentSkills.agents.claude-code = {
      skills = ["skill-creator" "ui-ux-pro-max"];
      targetDir = ".claude/skills";
    };
  };

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
