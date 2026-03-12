{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.motion";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = {
    plugins = {
      spider = {
        enable = true;
        keymaps.motions = {
          b = "b";
          e = "e";
          ge = "ge";
          w = "w";
        };
        # lazyLoad = {
        # enable = true;
        # settings.keys = [
        # "b"
        # "e"
        # "ge"
        # "w"
        # ];
        # };
      };
    };
    extraPlugins = [
      pkgs.vimPlugins.clever-f-vim
      pkgs.vimPlugins.vim-asterisk
      pkgs.vimPlugins.kensaku
      pkgs.vimPlugins.kensaku-search
      pkgs.vimPlugins.fuzzy-motion
    ];
    extraConfigLua = ''
      vim.g.clever_f_smart_case = 1
      vim.g.clever_f_timeout_ms = 2000

      vim.keymap.set({ "n", "x", "o" }, "*", "<Plug>(asterisk-z*)")
      vim.keymap.set({ "n", "x", "o" }, "#", "<Plug>(asterisk-z#)")
      vim.keymap.set({ "n", "x", "o" }, "g*", "<Plug>(asterisk-gz*)")
      vim.keymap.set({ "n", "x", "o" }, "g#", "<Plug>(asterisk-gz#)")

      -- kensaku-search: replace "/" search with kensaku
      vim.keymap.set("c", "<CR>", function()
        return vim.fn.getcmdtype() == "/" and "<Plug>(kensaku-search-replace)<CR>" or "<CR>"
      end, { expr = true })

      -- fuzzy-motion: trigger with Shift-S
      vim.keymap.set("n", "<S-s>", function()
        vim.cmd["FuzzyMotion"]()
      end, { noremap = true })
      vim.g["fuzzy_motion_matchers"] = { "kensaku", "fzf" }
    '';
  };
}
