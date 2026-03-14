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
    if moduleSystem == "darwin"
    then lib.mapAttrs (_: secret: secret.path) config.sops.secrets
    else {};

  darwin.always = {myconfig, ...}: let
    username = myconfig.constants.username;
    sharedSecrets = [
      "claude-code-oauth-token"
      "gemini-api-key"
      "ai-mop-api-key"
      "brave-api-key"
      "openrouter-api-key"
      "cerebras-api-key"
      "morph-fast-apply-api-key"
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
    # sops.defaultSopsFile = ./secrets.yaml;
  };
}
