{
  delib,
  homeConfig,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.git";

  options.programs.git = with delib; {
    enable = boolOption host.devCoreFeatured;
    enableLFS = boolOption true;
    ignore_names = readOnly (listOfOption str [
      ".agents"
      ".claude"
      ".opencode"
      ".DS_Store"
      ".direnv"
      ".envrc"
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
          useConfigOnly = true;
          signingkey = myconfig.programs.ssh.mainIdentity;
        };
        commit = {
          verbose = true;
          template = "${homeConfig.xdg.configHome}/git/.gitmsg";
          gpgsign = true;
        };
        push = {
          default = "nothing";
        };
        tag = {
          gpgsign = true;
        };
        gpg = {
          format = "ssh";
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
        ghq.root = "${homeConfig.xdg.dataHome}/ghq";
        url."git@github.com:".insteadOf = "https://github.com/";
      };
      ignores = cfg.ignore_names ++ cfg.ignore_patterns;
    };
    home.packages = [
      pkgs.ghq
    ];
    programs.difftastic = {
      enable = true;
      git = {
        enable = true;
        mode = "difftool";
      };
    };
  };
}
