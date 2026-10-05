{
  delib,
  inputs,
  lib,
  ...
}:
delib.module ({cfg, ...}: {
  name = "harness";
  meta.description = "Provide the self-built LLM agent harness, built on the Pi SDK with an OpenTUI interface.";

  options = {pkgs, ...}:
    with delib; {
      enable = boolOption true;
      settings = attrsOfOption anything {
        packages = ["npm:@commandcode/pi-commandcode-provider@0.3.0"];
        defaultProvider = "command-code";
        defaultModel = "meta/muse-spark-1.3-contributor";
      };
      package = packageOption (pkgs.callPackage ./package.nix {
        bun2nix = inputs.bun2nix.packages.${pkgs.stdenv.hostPlatform.system}.default;
        inherit (cfg) settings;
      });
    };

  hjem.ifEnabled = {
    config,
    pkgs,
    ...
  }: {
    packages = [
      cfg.package
    ];
    xdg.config.files."harness/models.json" = lib.mkIf (config.security.nix-secrets.secrets ? command-code-api-key) {
      generator = builtins.toJSON;
      value.providers.command-code.apiKey = "!${lib.getExe' pkgs.coreutils "cat"} ${lib.escapeShellArg config.security.nix-secrets.secrets.command-code-api-key.path}";
    };
  };

  bundles.ifEnabled.harness = {
    inherit (cfg) package;
  };
})
