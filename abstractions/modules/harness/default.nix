{
  delib,
  inputs,
  ...
}:
delib.module {
  name = "harness";
  meta.description = "Provide the self-built LLM agent harness, built on the Pi SDK with an OpenTUI interface.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: {
    packages = [
      (pkgs.callPackage ./package.nix {
        bun2nix = inputs.bun2nix.packages.${pkgs.stdenv.hostPlatform.system}.default;
      })
    ];
  };
}
