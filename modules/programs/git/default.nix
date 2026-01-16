{
  delib,
  homeConfig,
  ...
}:
delib.module {
  name = "programs.git";

  options.programs.git = with delib; {
    enable = boolOption true;
    enableLFS = boolOption true;
  };

  home.ifEnabled = {
    myconfig,
    cfg,
    ...
  }: {
    xdg.configFile.".gitmsg" = {
      target = "git/.gitmsg";
      source = ./gitmsg;
    };
    programs.git = {
      enable = cfg.enable;
      lfs.enable = cfg.enableLFS;

      settings = {
        user = {
          name = myconfig.constants.username;
          email = myconfig.constants.useremail;
        };
        alias = {
          stat = "status";
        };
        commit = {
          template = "${homeConfig.xdg.configHome}/git/.gitmsg";
        };
        core = {
          editor = "nvim";
        };
        init = {
          defaultBranch = "main";
        };
        mergetool.neovimdiff = {
          cmd = "nvim -d $LOCAL $MERGED $REMOTE -c 'wincmd l' -c 'wincmd J'";
        };
        merge = {
          tool = "neovimdiff";
        };
        url."git@github.com:".insteadOf = "https://github.com/";
      };
      ignores = [
        "*~"
        "*.swp"
        ".DS_Store"
        ".direnv"
        ".envrc"
        "var/"
      ];
    };
    programs.delta = {
      enable = true;
      enableGitIntegration = true;
    };
  };
}
