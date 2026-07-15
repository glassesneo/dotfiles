{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nvf.languages.swift";
  options = delib.singleCascadeEnableOption;
  home.ifEnabled.programs.nvf.settings.vim.treesitter.grammars = [
    pkgs.vimPlugins.nvim-treesitter.grammarPlugins.swift
  ];
}
