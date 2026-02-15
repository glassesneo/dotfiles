{
  delib,
  homeConfig,
  inputs,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "config.agenix-shared";

  options.agenix-shared = with delib; {
    enable = boolOption false;
    exportSecrets = listOfOption str [];
  };

  home.always.imports = [inputs.agenix.homeManagerModules.default];

  home.ifEnabled = {myconfig, ...}: let
    cfg = myconfig.agenix-shared;
    secretDefs = myconfig.args.shared.agenixSecrets;
    cat = lib.getExe' pkgs.coreutils "cat";

    # Helper to generate secret file mapping
    mkSecretFile = secretName: {
      file = ../../secrets/${secretName}.age;
    };
  in {
    # Configure agenix identity path
    age.identityPaths = ["/Users/${myconfig.constants.username}/.ssh/id_agenix"];

    # Auto-generate secret file mappings for ALL secrets
    age.secrets = lib.genAttrs secretDefs.secretNames mkSecretFile;

    # Auto-generate environment variable exports ONLY for selected secrets
    home.sessionVariables = let
      # Filter to only export selected secrets
      exportedSecrets = lib.filter (s: builtins.elem s cfg.exportSecrets) secretDefs.secretNames;

      # Generate env var mapping for each exported secret
      mkEnvVar = secretName: let
        envVarName = secretDefs.secretToEnvVar.${secretName};
        secretPath = homeConfig.age.secrets.${secretName}.path;
      in {
        name = envVarName;
        value = ''$(${cat} ${secretPath})'';
      };
    in
      builtins.listToAttrs (map mkEnvVar exportedSecrets);
  };
}

