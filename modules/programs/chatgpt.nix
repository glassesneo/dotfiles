{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.chatgpt";

  options = delib.singleEnableOption (pkgs.stdenv.isDarwin && host.guiShellFeatured);

  home.ifEnabled = {
    home.packages = with pkgs; [
      chatgpt
    ];
  };
}
