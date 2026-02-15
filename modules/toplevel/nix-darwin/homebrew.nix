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
        "karabiner-elements"
      ];

      masApps = {
        # Temporarily commented out due to mas download issues
        # XCode = 497799835;
        # LINE = 539883307;
      };
    };
  };
}
