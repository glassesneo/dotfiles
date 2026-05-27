{
  delib,
  host,
  ...
}:
delib.module {
  name = "programs.zoxide";

  options = delib.singleEnableOption host.devCoreFeatured;

  home.ifEnabled.programs.zoxide = {
    enable = true;
    enableZshIntegration = true;
  };
}
