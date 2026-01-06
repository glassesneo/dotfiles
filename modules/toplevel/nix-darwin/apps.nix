{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "nix-darwin";

  darwin.always = {
    environment.systemPackages = with pkgs; [
      maccy
      raycast
      tart
      # amazon-q-cli
    ];
  };
}
