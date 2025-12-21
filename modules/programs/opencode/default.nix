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
  };
}
