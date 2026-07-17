{
  config,
  delib,
  inputs,
  lib,
  moduleSystem,
  ...
}:
delib.module {
  name = "toplevel.secrets";

  myconfig.always.args.shared.sopsSecretPaths =
    if builtins.elem moduleSystem ["darwin" "nixos"]
    then lib.mapAttrs (_: secret: secret.path) config.sops.secrets
    else {};

  darwin.always = {myconfig, ...}: let
    username = myconfig.constants.username;
    sharedSecrets = [
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

    # mkUserSecret = _: {
    # owner = username;
    # mode = "0400";
    # };
    mkSharedSecret = _: {
      sopsFile = ../../secrets/shared.yaml;
      owner = username;
      mode = "0400";
    };
  in {
    imports = [inputs.sops-nix.darwinModules.sops];

    sops = {
      age.keyFile = "/Users/${username}/.config/sops/age/keys.txt";
      secrets = lib.genAttrs sharedSecrets mkSharedSecret;
    };
  };

  nixos.always = {myconfig, ...}: let
    username = myconfig.constants.username;
    sharedSecrets = [
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
    mkSharedSecret = _: {
      sopsFile = ../../secrets/shared.yaml;
      owner = username;
      mode = "0400";
    };
  in {
    imports = [inputs.sops-nix.nixosModules.sops];

    sops = {
      age.keyFile = "/home/${username}/.config/sops/age/keys.txt";
      secrets = lib.genAttrs sharedSecrets mkSharedSecret;
    };
  };
}
