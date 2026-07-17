{
  config,
  delib,
  inputs,
  lib,
  moduleSystem,
  ...
}: let
  sharedSecretNames = [
    "gemini-api-key"
    "ai-mop-api-key"
    "brave-api-key"
    "openrouter-api-key"
    "cerebras-api-key"
    "google-cloud-api-key"
    "zai-api-key"
    "iniad-id"
    "iniad-password"
  ];
in
  delib.module {
    name = "toplevel.secrets";

    options = with delib;
      moduleOptions {
        enable = boolOption true;
        names = listOfOption (lib.types.enum sharedSecretNames) sharedSecretNames;
      };

    myconfig.always = {cfg, ...}: {
      args.shared.sopsSecretPaths =
        if cfg.enable && builtins.elem moduleSystem ["darwin" "nixos"]
        then lib.mapAttrs (_: secret: secret.path) config.sops.secrets
        else {};
    };

    # Nix module imports cannot depend on config. Keep the upstream module
    # available and gate only secret provisioning through the typed interface.
    darwin.always.imports = [inputs.sops-nix.darwinModules.sops];

    darwin.ifEnabled = {
      cfg,
      myconfig,
      ...
    }: let
      username = myconfig.constants.username;

      mkSharedSecret = _: {
        sopsFile = ../../secrets/shared.yaml;
        owner = username;
        mode = "0400";
      };
    in {
      sops = {
        age.keyFile = "/Users/${username}/.config/sops/age/keys.txt";
        secrets = lib.genAttrs cfg.names mkSharedSecret;
      };
    };

    nixos.always.imports = [inputs.sops-nix.nixosModules.sops];

    nixos.ifEnabled = {
      cfg,
      myconfig,
      ...
    }: let
      username = myconfig.constants.username;

      mkSharedSecret = _: {
        sopsFile = ../../secrets/shared.yaml;
        owner = username;
        mode = "0400";
      };
    in {
      sops = {
        age.keyFile = "/home/${username}/.config/sops/age/keys.txt";
        secrets = lib.genAttrs cfg.names mkSharedSecret;
      };
    };
  }
