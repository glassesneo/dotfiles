{
  delib,
  nixvimLsp,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.lsp.servers-exceptions";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nixvim = let
    copilotPkgs = import pkgs.path {
      inherit (pkgs.stdenv.hostPlatform) system;
      config.allowUnfree = true;
    };
  in {
    lsp.servers.copilot = nixvimLsp.mkServer {
      activate = true;
    };

    extraPackages = [
      pkgs.efm-langserver
      pkgs.nls
      pkgs.nickel
      copilotPkgs.copilot-language-server
    ];
  };
}
