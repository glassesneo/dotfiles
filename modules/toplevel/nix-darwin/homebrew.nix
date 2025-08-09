{delib, ...}:
delib.module {
  name = "nix-darwin.homebrew";

  options = delib.singleEnableOption true;

  darwin.ifEnabled = {cfg, ...}: {
    homebrew = {
      enable = cfg.enable;

      onActivation = {
        autoUpdate = false;
        # 'zap': uninstalls all formulae(and related files) not listed here.
        cleanup = "zap";
      };

      taps = [
        "homebrew/services"
      ];

      # `brew install`
      brews = [
        "mas"
      ];

      # `brew install --cask`
      casks = [
        "arc"
        "aquaskk"
        "discord"
        "karabiner-elements"
        "zoom"
      ];

      masApps = {
        XCode = 497799835;
        LINE = 539883307;
      };
    };
  };
}
