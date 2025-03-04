{pkgs, ...}: {
  xdg.configFile.nvim.source = ../../nvim;

  home.sessionVariables = {
    EDITOR = "nvim";
    VISUAL = "nvim";
  };

  programs.neovim = {
    enable = true;
    extraLuaConfig = builtins.readFile ../../nvim/init.lua;
    withNodeJs = false;
    withPython3 = false;
    withRuby = false;
    extraPackages = with pkgs; [
      # nufmt
      #typescript
      # biome
      # typescript-language-server
      # svelte-language-server
      # tailwindcss-language-server
      # scala
      # scalafmt
      # metals
      # python
      # pylyzer
      # ruff
      # kotlin
      # kotlin-language-server
      # ktfmt
    ];
  };
}
