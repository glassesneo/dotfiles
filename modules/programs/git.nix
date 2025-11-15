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
      text = ''
        # Commit type
        # build: Changes that affect the build system or external dependencies
        # chore: Changes that doesn't affect the source code itself
        # ci: Changes to our CI configuration files and scripts (example scopes: Travis, Circle, BrowserStack, SauceLabs)
        # docs: Documentation only changes
        # feat: A new feature
        # fix: A bug fix
        # perf: A code change that improves performance
        # refactor: A code change that neither fixes a bug nor adds a feature
        # revert: A code change that reverts previous commits
        # style: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
        # test: Adding missing tests or correcting existing tests
      '';
    };
    programs.git = {
      enable = cfg.enable;
      lfs.enable = cfg.enableLFS;

      settings = {
        user = {
          name = myconfig.constants.username;
          email = myconfig.constants.useremail;
        };
      };

      settings = {
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
