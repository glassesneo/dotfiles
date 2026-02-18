{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "nix-darwin";

  options = delib.singleEnableOption host.guiShellFeatured;

  darwin.ifEnabled = {
    environment.systemPackages = with pkgs; [
      maccy
      raycast
      tart
      # amazon-q-cli
    ];
  };
}
