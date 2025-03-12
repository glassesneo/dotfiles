{pkgs, ...}: {
  plugins = {
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
}
