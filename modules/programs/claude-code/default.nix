{
  delib,
  inputs,
  nodePkgs,
  pkgs,
  ...
}:
let
  # SketchyBar integration hook scripts
  sketchybarActiveScript = pkgs.writeShellScript "sketchybar-claude-active" ''
    set -euo pipefail
    # Read JSON input from stdin (required by Claude Code hook protocol)
    INPUT=$(cat)
    # Extract project directory from JSON input
    PROJECT_DIR=$(echo "$INPUT" | ${pkgs.lib.getExe pkgs.jq} -r '.projectDirectory // ""')
    # Trigger SketchyBar event to show Claude as active with project directory
    ${pkgs.lib.getExe pkgs.sketchybar} --trigger claude_status STATUS=active PROJECT_DIR="$PROJECT_DIR" 2>/dev/null || true
    # Return empty JSON response (required by hook protocol)
    echo '{}'
  '';

  sketchybarInactiveScript = pkgs.writeShellScript "sketchybar-claude-inactive" ''
    set -euo pipefail
    # Read JSON input from stdin (required by Claude Code hook protocol)
    INPUT=$(cat)
    # Trigger SketchyBar event to show Claude as inactive
    ${pkgs.lib.getExe pkgs.sketchybar} --trigger claude_status STATUS=inactive 2>/dev/null || true
    # Return empty JSON response (required by hook protocol)
    echo '{}'
  '';
in
delib.module {
  name = "programs.claude-code";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    programs.claude-code = {
      enable = true;
      package = nodePkgs."@anthropic-ai/claude-code";
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

    # Import skills from anthropic-skills repository
    home.file = {
      ".claude/skills/sparze".source = inputs.sparze.outPath;
    };
  };
}
