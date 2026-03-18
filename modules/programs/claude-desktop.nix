{
  brewCasks,
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.claude-desktop";

  options = delib.singleEnableOption (pkgs.stdenv.isDarwin && host.guiShellFeatured);

  home.ifEnabled = {
    home.file."Applications/Claude.app".source = "${brewCasks.claude}/Applications/Claude.app";
  };
}
