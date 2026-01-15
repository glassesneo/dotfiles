{delib, ...}:
delib.module {
  name = "programs.nixvim";

  home.ifEnabled.programs.nixvim = {
    autoCmd = [
      {
        event = "FileType";
        pattern = ["python" "zig"];
        callback.__raw = ''
          function()
          vim.bo.expandtab = true
          vim.bo.tabstop = 4
          vim.bo.shiftwidth = 4
          end
        '';
      }
      {
        event = "FileType";
        pattern = ["go"];
        callback.__raw = ''
          function()
            vim.bo.expandtab = false
            vim.bo.tabstop = 4
            vim.bo.shiftwidth = 4
          end
        '';
      }
    ];
  };
}
