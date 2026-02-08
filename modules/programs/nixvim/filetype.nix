{delib, ...}:
delib.module {
  name = "programs.nixvim";

  home.ifEnabled.programs.nixvim = {
    # Add filetype detection for languages not built into Neovim
    extraConfigLua = ''
      vim.filetype.add({
        extension = {
          ncl = "nickel",
          prisma = "prisma",
          mbt = "moonbit",
          mbti = "moonbit",
          mbi = "moonbit",
        },
      })
    '';

    autoCmd = [
      {
        event = ["BufRead" "BufNewFile"];
        pattern = ["*.mbt" "*.mbti" "*.mbi"];
        callback.__raw = ''
          function()
            vim.bo.filetype = "moonbit"
          end
        '';
      }
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
