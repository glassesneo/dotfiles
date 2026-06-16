{
  delib,
  host,
  inputs,
  ...
}:
delib.module {
  name = "programs.nvf";

  options = delib.singleEnableOption host.devCoreFeatured;

  home.always.imports = [
    inputs.nvf.homeManagerModules.default
    ({
      config,
      pkgs,
      ...
    }: {
      home.packages = [
        (pkgs.writeShellScriptBin "nvf" ''
          exec ${config.programs.nvf.settings.vim.build.finalPackage}/bin/nvim "$@"
        '')
      ];
    })
  ];

  home.ifEnabled = {
    programs.nvf = {
      enable = false;
      enableManpages = true;
      settings = {
        vim = {
          viAlias = false;
          vimAlias = false;
        };
      };
    };
  };
}
