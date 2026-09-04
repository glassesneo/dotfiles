{
  delib,
  host,
  inputs,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nvf";

  options = delib.singleEnableOption host.devCoreFeatured;

  home.always.imports = [
    inputs.nvf.homeManagerModules.default
  ];

  home.ifEnabled = {
    programs.nvf = {
      enable = true;
      enableManpages = true;
      settings = {
        vim = {
          package = inputs.neovim-nightly-overlay.packages.${pkgs.stdenv.hostPlatform.system}.default;
          viAlias = false;
          vimAlias = false;
        };
      };
    };
  };
}
