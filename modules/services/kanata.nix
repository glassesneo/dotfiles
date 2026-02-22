{
  delib,
  host,
  inputs,
  ...
}:
delib.module {
  name = "kanata";

  options = delib.singleEnableOption host.guiShellFeatured;

  darwin.always.imports = [inputs.kanata-darwin-nix.darwinModules.default];

  darwin.ifEnabled.services.kanata = {
    enable = false;
    keyboards = {
      default = {
        configFile = ./kanata.kbd;
        port = 5829;
        vkAgent = {
          enable = true;
          blacklist = [];
        };
      };
    };
  };
}
