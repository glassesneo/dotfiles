{
  delib,
  host,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.ssh";

  options.programs.ssh = with delib; {
    enable = boolOption host.devCoreFeatured;
    mainIdentity = readOnly (strOption "~/.ssh/id_ed25519_personal");
  };

  home.ifEnabled = {cfg, ...}: {
    programs.ssh = {
      enable = true;
      enableDefaultConfig = false;

      settings = {
        "github.com" = {
          HostName = "github.com";
          User = "git";
          IdentityFile = cfg.mainIdentity;
        };

        "github-company" = {
          HostName = "github.com";
          User = "git";
          IdentityFile = "~/.ssh/id_ed25519_company";
        };
        "*" = lib.mkMerge [
          {
            AddKeysToAgent = "yes";
            IdentitiesOnly = "yes";
          }
          (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
            UseKeychain = "yes";
          })
        ];
      };
    };
  };
}
