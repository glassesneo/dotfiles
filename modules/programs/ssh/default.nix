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
    enable = boolOption true;
    mainIdentity = readOnly (strOption "~/.ssh/id_ed25519_personal");
  };

  home.ifEnabled = {
    cfg,
    myconfig,
    ...
  }: {
    programs.ssh = let
      otherHosts = lib.filter (h: h != host.name) (builtins.attrNames myconfig.hosts);
    in {
      enable = true;
      enableDefaultConfig = false;

      matchBlocks = lib.mkMerge [
        {
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
        }
        (lib.genAttrs otherHosts (host: {
          hostname = "${host}.local";
          user = myconfig.constants.username;
          identityFile = cfg.mainIdentity;
        }))
      ];
    };
  };
}
