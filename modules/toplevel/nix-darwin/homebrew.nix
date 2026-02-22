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
      ];

      # `brew install`
      brews = [
      ];

      # `brew install --cask`
      casks = [
      ];

      masApps = {
        # Temporarily commented out due to mas download issues
        # XCode = 497799835;
        # LINE = 539883307;
      };
    };
  };
}
