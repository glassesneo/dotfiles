{
  delib,
  homeConfig,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.helpers";

  options = delib.singleEnableOption true;

  # Phase 1: Keymap ownership matrix - determines which module owns contested keys
  # Phase 2: Capability contracts - replaces direct cross-plugin option reads
  myconfig.always.args.shared.nixvimConventions = let
    # Resolve enable states from the home-manager config
    snacksEnabled = homeConfig.programs.nixvim.plugins.snacks.enable;
    fzfEnabled = homeConfig.programs.nixvim.plugins.fzf-lua.enable;
    oilEnabled = homeConfig.programs.nixvim.plugins.oil.enable;
  in {
    # --- Phase 1: Keymap Ownership Matrix ---
    # Ownership rules:
    #   snacks=on: all three contested keys owned by snacks
    #   snacks=off,fzf=on,oil=on: <Space><Space>/<Space>g -> fzf-lua, <Space>f -> oil
    #   snacks=off,fzf=on,oil=off: <Space><Space>/<Space>g -> fzf-lua, <Space>f unbound
    #   snacks=off,fzf=off,oil=on: <Space>f -> oil, others unbound
    #   snacks=off,fzf=off,oil=off: all three contested keys unbound
    keymapOwnership = {
      smartPicker =
        if snacksEnabled then "snacks"
        else if fzfEnabled then "fzf-lua"
        else null;
      grep =
        if snacksEnabled then "snacks"
        else if fzfEnabled then "fzf-lua"
        else null;
      explorer =
        if snacksEnabled then "snacks"
        else if oilEnabled then "oil"
        else null;
    };

    # --- Phase 2: Capability Contracts ---
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
