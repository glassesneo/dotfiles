{
  delib,
  lib,
  ...
}:
delib.module ({myconfig, ...}: {
  name = "git";
  meta.description = "Provide Git with signed commits, a commit message template, and global ignores.";

  options.enable = delib.boolOption true;

  hjem.always = {pkgs, ...}: {
    options.git.settings = lib.mkOption {
      type = (pkgs.formats.gitIni {}).type;
      default = {};
      description = "Settings written to the user's Git configuration file.";
    };
  };

  hjem.ifEnabled = {
    config,
    pkgs,
    ...
  }: {
    packages = [
      pkgs.git
      pkgs.git-lfs
    ];

    git.settings = {
      user = {
        name = myconfig.identity.fullName;
        email = myconfig.identity.email;
        useConfigOnly = true;
        signingkey = myconfig.ssh.mainIdentity;
      };
      commit = {
        verbose = true;
        template = "${config.xdg.config.directory}/git/gitmsg";
        gpgsign = true;
      };
      tag.gpgsign = true;
      gpg.format = "ssh";
      push.default = "nothing";
      init.defaultBranch = "main";
      core.excludesFile = "${config.xdg.config.directory}/git/ignore";
      url."git@github.com:".insteadOf = "https://github.com/";
      filter.lfs = {
        clean = "git-lfs clean -- %f";
        smudge = "git-lfs smudge -- %f";
        process = "git-lfs filter-process";
        required = true;
      };
    };

    xdg.config.files = {
      "git/config" = {
        exclusive = true;
        generator = lib.generators.toGitINI;
        value = config.git.settings;
      };
      "git/gitmsg" = {
        exclusive = true;
        source = ./gitmsg;
      };
      "git/ignore" = {
        exclusive = true;
        text = ''
          .agents
          .DS_Store
          .direnv
          .envrc
          var/
          *~
          *.swp
        '';
      };
    };
  };
})
