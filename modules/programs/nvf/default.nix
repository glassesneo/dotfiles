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
  ];

  home.ifEnabled = {
    programs.nvf = {
      enable = true;
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
