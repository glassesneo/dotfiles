{
  homebrew = {
    enable = true;

    onActivation = {
      autoUpdate = false;
      # 'zap': uninstalls all formulae(and related files) not listed here.
      cleanup = "zap";
    };

    taps = [
      "homebrew/services"
      # "FelixKratz/formulae"
    ];

    # `brew install`
    brews = [
      "mas"
      "emscripten"
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
      # XCode = 497799835;
      LINE = 539883307;
    };
  };
}
