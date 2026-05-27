{
  delib,
  host,
  ...
}:
delib.module {
  name = "programs.ripgrep";

  options = delib.singleEnableOption host.devCoreFeatured;

  home.ifEnabled = {
    programs = {
      ripgrep-all = {
        enable = true;
      };
      ripgrep = {
        enable = true;
      };
    };
  };
}
