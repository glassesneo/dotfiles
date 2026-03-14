{delib, ...}:
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
          extraOptions = {
            AddKeysToAgent = "yes";
            IdentitiesOnly = "yes";
            SetEnv = "TERM=xterm-256color";
          };
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
