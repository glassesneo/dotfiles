{
  delib,
  homeConfig,
  inputs,
  llm-agents,
  ...
}:
delib.module {
  name = "programs.opencode";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    programs.opencode = {
      enable = true;
      package = llm-agents.opencode;
      settings = {
        autoshare = false;
        autoupdate = false;
        agent = {
          explore = {
            model = "github-copilot/gpt-5.2";
          };
        };
        experimental = {
          mcp_timeout = 1200000; # 20 minutes for Codex MCP
        };
      };
      rules =
        homeConfig.programs.claude-code.memory.text
        + ''
          ### Note
          - If you are unable to run commands in background, use `nohup` command
          - Make sure terminate your nohup process
        '';
    };

    # Deploy SketchyBar integration plugin
    xdg.configFile."opencode/plugin/sketchybar.ts".source = ./plugins/sketchybar.ts;
  };
}
