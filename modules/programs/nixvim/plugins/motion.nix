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
    extraPlugins = with pkgs.vimPlugins; [
      clever-f-vim
      vim-asterisk
    ];
    extraConfigLua = ''
      vim.g.clever_f_smart_case = 1
      vim.g.clever_f_timeout_ms = 2000

      vim.keymap.set({ "n", "x", "o" }, "*", "<Plug>(asterisk-z*)")
      vim.keymap.set({ "n", "x", "o" }, "#", "<Plug>(asterisk-z#)")
      vim.keymap.set({ "n", "x", "o" }, "g*", "<Plug>(asterisk-gz*)")
      vim.keymap.set({ "n", "x", "o" }, "g#", "<Plug>(asterisk-gz#)")
    '';
  };
}
