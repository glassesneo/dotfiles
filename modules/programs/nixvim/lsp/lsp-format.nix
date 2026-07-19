{delib, ...}:
delib.module {
  name = "programs.nixvim.lsp.lsp-format";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nixvim.plugins.lsp-format = {
    enable = true;
    lspServersToEnable = [
      "efm"
      "denols"
      "hls"
      "moonbit-lsp"
      "taplo"
      "zls"
    ];
  };
}
