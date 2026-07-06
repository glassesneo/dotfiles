{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nvf.orgmode";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {
    programs.nvf.settings.vim = {
      additionalRuntimePaths = [
        "${pkgs.lua51Packages.tree-sitter-orgmode}/lib/lua/5.1"
      ];

      notes.orgmode = {
        enable = true;
        treesitter.enable = true;
        setupOpts = {
          org_startup_indented = true;
        };
      };
    };
  };
}
