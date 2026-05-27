{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.gh";

  options = delib.singleEnableOption host.devCoreFeatured;

  home.ifEnabled.programs.gh = {
    enable = true;
    extensions = [pkgs.gh-markdown-preview];
    settings = {
      git_protocol = "ssh";
    };
  };
}
