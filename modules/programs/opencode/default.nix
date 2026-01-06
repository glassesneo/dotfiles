{
  delib,
  homeConfig,
  host,
  inputs,
  ...
}:
delib.module {
  name = "programs.opencode";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    programs.opencode = {
      enable = true;
      package = inputs.opencode.packages."${host.homeManagerSystem}".default;
      settings = {
        theme = "catppuccin";
        autoshare = false;
        autoupdate = false;
        experimental = {
          mcp_timeout = 1200000; # 20 minutes for Codex MCP
        };
      };
      themes = {
        transparent-catppuccin = ./themes/transparent-catppuccin.json;
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
