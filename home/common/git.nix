{config, ...}: {
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
