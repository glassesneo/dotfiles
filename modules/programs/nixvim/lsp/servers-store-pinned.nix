{
  delib,
  homeConfig,
  inputs,
  lib,
  nixvimLsp,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.lsp.servers-store-pinned";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nixvim = let
    inherit (homeConfig.home) stateVersion;
    _pkgs = "import ${pkgs.path} {}";
  in {
    lsp.servers = {
      bashls = nixvimLsp.mkServer {
        cmd = ["${lib.getExe pkgs.bash-language-server}"];
        activate = true;
      };
      nixd = nixvimLsp.mkServer {
        package = pkgs.nixd;
        activate = true;
        settings.nixd = {
          formatting.command = ["${pkgs.alejandra}/bin/alejandra"];
          nixpkgs.expr = _pkgs;
          options.home-manager.expr = ''
            let
              hmFlake = builtins.getFlake "${inputs.home-manager.outPath}";
              nixvimFlake = builtins.getFlake "${inputs.nixvim.outPath}";
              pkgs = ${_pkgs};
            in
              (hmFlake.lib.homeManagerConfiguration {
                inherit pkgs;
                modules = [
                  nixvimFlake.homeModules.nixvim
                  {
                    home = {
                      username = "neo";
                      homeDirectory = "/Users/neo";
                      stateVersion = "${stateVersion}";
                    };
                  }
                ];
              }).options
          '';
        };
      };
      nickel_ls = nixvimLsp.mkServer {
        package = pkgs.nls;
        activate = true;
      };
    };
  };
}
