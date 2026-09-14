{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nvf.statusline";
  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nvf.settings.vim = {
    additionalRuntimePaths = [./runtime];

    extraPlugins = {
      nvim-navic = {
        package = pkgs.vimPlugins.nvim-navic;
        setup = ''
          require("nvim-navic").setup({
            highlight = true,
            lsp = { auto_attach = true },
            separator = " > ",
          })
        '';
      };
      heirline = {
        package = pkgs.vimPlugins.heirline-nvim;
        setup = "require('nvf.statusline').setup()";
        after = ["nvim-navic"];
      };
    };
  };
}
