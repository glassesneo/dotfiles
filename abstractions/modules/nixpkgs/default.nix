{delib, ...}:
delib.module ({myconfig, ...}: {
  name = "nixpkgs";
  meta.description = "Configure Nixpkgs for the host.";

  darwin.always.nixpkgs.hostPlatform = myconfig.host.system;
})
