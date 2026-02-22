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
    enable = true;
    keyboards = {
      default = {
        configFile = ./kanata.kbd;
        port = 5829;
        vkAgent = {
          enable = false;
          blacklist = [];
        };
      };
    };
  };
}
