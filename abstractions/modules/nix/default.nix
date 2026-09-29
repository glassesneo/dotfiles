{delib, ...}:
delib.module ({myconfig, ...}: {
  name = "nix";

  darwin.always.nix.settings = {
    experimental-features = ["nix-command" "flakes"];
    trusted-users = ["root" "@admin"] ++ builtins.attrNames myconfig.host.users;
  };
})
