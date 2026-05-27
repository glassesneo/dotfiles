{
  delib,
  host,
  ...
}:
delib.module {
  name = "programs.eza";

  options = delib.singleEnableOption host.devCoreFeatured;

  home.ifEnabled = {
    programs.eza = {
      enable = true;
      enableZshIntegration = true;
      git = true;
      icons = "auto";
    };
    home.shellAliases = {
      tree = "eza -T";
    };
  };
}
