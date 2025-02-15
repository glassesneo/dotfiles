{config, ...}: {
  xdg.configFile.".gitmsg" = {
    source = ../../git/.gitmsg;
    target = "git/.gitmsg";
  };
  programs.git = {
    enable = true;
    userName = "glassesneo";
    userEmail = "glassesneo@protonmail.com";
    delta.enable = true;
    extraConfig = {
      commit = {
        template = "${config.xdg.configHome}/git/.gitmsg";
      };
      core = {
        editor = "nvim";
      };
      init = {
        defaultBranch = "main";
      };
    };
    ignores = [
      "*~"
      "*.swp"
      ".DS_Store"
      ".direnv"
      ".envrc"
    ];
  };
}
