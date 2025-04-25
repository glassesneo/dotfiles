{
  plugins = {
    lsp.servers.efm = {
      extraOptions = {
        init_options = {
          documentFormatting = true;
          documentRangeFormatting = true;
        };
      };
      filetypes = ["elm" "nix" "nim" "python" "lua" "typst"];
      settings = {
        languages = {
          elm = [
            {
              formatCommand = "elm-format --stdin";
              formatStdin = true;
            }
          ];
          nim = [
            {
              formatCommand = "nph -";
              formatStdin = true;
            }
          ];
          nix = [
            {
              formatCommand = "alejandra -";
              formatStdin = true;
            }
          ];
          # python = [
          # {
          # formatCommand
          # }
          # ];
          lua = [
            {
              formatCommand = "stylua --indent-type Spaces --indent-width 2 -";
              formatStdin = true;
            }
          ];
          typst = [
            {
              formatCommand = "typstyle";
              formatStdin = true;
            }
          ];
        };
      };
    };
    lsp-format = {
      enable = true;
      lspServersToEnable = [
        "efm"
        "denols"
        "hls"
        "taplo"
        "zls"
      ];
    };
  };
}
