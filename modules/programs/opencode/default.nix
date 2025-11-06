{
  delib,
  homeConfig,
  ...
}:
delib.module {
  name = "programs.opencode";

  options = delib.singleEnableOption true;

  home.ifEnabled = {
    programs.opencode = {
      enable = true;
      settings = {
        theme = "catppuccin";
        autoshare = false;
        autoupdate = false;
      };
      themes = {
        transparent-catppuccin = ./themes/transparent-catppuccin.json;
      };
      rules = homeConfig.programs.claude-code.memory.text;
    };
  };
}
