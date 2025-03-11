{
  plugins = {
    lsp = {
      enable = true;
      inlayHints = true;
      servers = {
        efm = {
          enable = true;
          extraOptions = {
            init_options = {
              documentFormatting = true;
              documentRangeFormatting = true;
            };
          };
          filetypes = ["nix"];
          settings = {
            rootMarkers = [
              ".git/"
            ];
            languages = {
              nix = [
                {
                  formatCommand = "alejandra -";
                  formatStdin = true;
                }
              ];
            };
          };
        };
        nil_ls = {
          enable = true;
          settings = {
            nix = {
              flake = {
                autArchive = true;
              };
            };
          };
        };
      };
    };
    lsp-format = {
      enable = true;
      lspServersToEnable = [
        "efm"
      ];
    };
  };
}
