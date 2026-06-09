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

  home.ifEnabled = {
    cfg,
    myconfig,
    ...
  }: {
    programs.ssh = let
      # otherHosts = lib.filter (h: h != host.name) (builtins.attrNames myconfig.hosts);
    in {
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
            # SetEnv = "TERM=xterm-256color";
          }
          (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
            UseKeychain = "yes";
          })
        ];
      };

      # matchBlocks = lib.mkMerge [
      # (lib.genAttrs otherHosts (host: {
      # HostName = "${host}.local";
      # User = myconfig.constants.Username;
      # IdentityFile = cfg.mainIdentity;
      # }))
      # ];
    };
  };
}
