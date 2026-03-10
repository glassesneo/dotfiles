{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.lsp.lsp-format";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nixvim.plugins.lsp-format = {
    enable = true;
    package = pkgs.vimPlugins.lsp-format-nvim.overrideAttrs (old: {
      postPatch =
        (old.postPatch or "")
        + ''
          substituteInPlace lua/lsp-format/init.lua \
            --replace-fail 'client.supports_method(' 'client:supports_method(' \
            --replace-fail 'client.request_sync(' 'client:request_sync(' \
            --replace-fail 'client.request(' 'client:request('
        '';
    });
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
