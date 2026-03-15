{
  delib,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.ssh";

  options.programs.ssh = with delib; {
    enable = boolOption true;
    mainIdentity = readOnly (strOption "~/.ssh/id_ed25519_personal");
  };

  home.ifEnabled = {cfg, ...}: {
    programs.ssh = {
      enable = true;
      enableDefaultConfig = false;

      matchBlocks = {
        "*" = {
          extraOptions = lib.mkMerge [
            {
              AddKeysToAgent = "yes";
              IdentitiesOnly = "yes";
              SetEnv = "TERM=xterm-256color";
            }
            (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
              UseKeychain = "yes";
            })
          ];
        };
        "github.com" = {
          hostname = "github.com";
          user = "git";
          identityFile = cfg.mainIdentity;
        };

        "github-company" = {
          hostname = "github.com";
          user = "git";
          identityFile = "~/.ssh/id_ed25519_company";
        };
      };
    };
  };
}
