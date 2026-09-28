{delib, ...}:
delib.module ({myconfig, ...}: {
  name = "platform";

  darwin.always.nixpkgs.hostPlatform = myconfig.host.system;
})
