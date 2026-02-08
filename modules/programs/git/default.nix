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
    ignore_names = readOnly (listOfOption str [
      ".agents"
      ".claude"
      ".opencode"
      ".DS_Store"
      ".direnv"
      ".envrc"
      ".kiri"
      "var/"
    ]);
    ignore_patterns = readOnly (listOfOption str [
      "*~"
      "*.swp"
    ]);
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
      enable = true;
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
      ignores = cfg.ignore_names ++ cfg.ignore_patterns;
    };
    programs.delta = {
      enable = true;
      enableGitIntegration = true;
    };
  };
}
