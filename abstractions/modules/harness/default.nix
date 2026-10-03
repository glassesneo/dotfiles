{
  delib,
  inputs,
  ...
}:
delib.module ({cfg, ...}: {
  name = "harness";
  meta.description = "Provide the self-built LLM agent harness, built on the Pi SDK with an OpenTUI interface.";

  options = {pkgs, ...}:
    with delib; {
      enable = boolOption true;
      package = packageOption (pkgs.callPackage ./package.nix {
        bun2nix = inputs.bun2nix.packages.${pkgs.stdenv.hostPlatform.system}.default;
      });
    };

  hjem.ifEnabled = {
    packages = [
      cfg.package
    ];
  };
})
