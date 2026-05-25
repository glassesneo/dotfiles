{
  delib,
  brewCasks,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.atlas";

  options = delib.singleEnableOption (pkgs.stdenv.isDarwin && host.guiShellFeatured);

  home.ifEnabled = {
    home.packages = [
      brewCasks.chatgpt-atlas
    ];
  };
}
