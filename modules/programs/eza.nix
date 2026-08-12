{
  delib,
  host,
  wrappers,
  ...
}:
delib.module {
  name = "programs.eza";

  options = delib.singleEnableOption host.devCoreFeatured;

  home.ifEnabled = let
    package = wrappers.eza {
      flags = [
        "--git"
        "--icons=auto"
      ];
    };
  in {
    programs.eza = {
      enable = true;
      inherit package;
      enableZshIntegration = true;
    };
    home.shellAliases = {
      tree = "eza -T";
    };
  };
}
