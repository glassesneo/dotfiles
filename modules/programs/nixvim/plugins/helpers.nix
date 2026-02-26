{
  delib,
  homeConfig,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.helpers";

  options = delib.singleEnableOption true;

  # Capability contracts - replaces direct cross-plugin option reads
  myconfig.always.args.shared.nixvimConventions = {
    # --- Capability Contracts ---
    # Replaces direct homeConfig.programs.nixvim.plugins.*.enable reads
    capabilities = {
      hasIncRename = homeConfig.programs.nixvim.plugins.inc-rename.enable;
      hasCodeCompanion = homeConfig.programs.nixvim.plugins.codecompanion.enable;
    };
  };

  home.ifEnabled.programs.nixvim = {
    extraPlugins = with pkgs.vimPlugins; [
      vim-eunuch
      mkdir-nvim
      {
        plugin = numb-nvim;
        optional = true;
      }
    ];
    extraConfigLua = ''
      require('lz.n').load({{
        'numb.nvim',
        event = {"CmdlineEnter"},
        after = function()
          require('numb').setup()
        end,
      }})
    '';
  };
}
