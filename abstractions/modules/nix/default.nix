{delib, ...}:
delib.module ({myconfig, ...}: {
  name = "nix";
  meta.description = "Configure Nix itself.";

  darwin.always.nix.settings = {
    experimental-features = ["nix-command" "flakes"];
    trusted-users = ["root" "@admin" myconfig.host.user.name];
  };
})
