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
      "FelixKratz/formulae"
    ];

    # `brew install`
    brews = [
      "mas"
      "emscripten"
      {
        name = "sketchybar";
        start_service = false;
        restart_service = "changed";
      }
    ];

    # `brew install --cask`
    casks = [
      "arc"
      "canva"
      "discord"
      "ghostty"
      "karabiner-elements"
      "keycastr"
      "kitty"
      "notion"
      "orbstack"
      "proton-drive"
      "proton-pass"
      "raycast"
      "slack"
      "zoom"
      "nikitabobko/tap/aerospace"
    ];

    masApps = {
      XCode = 497799835;
      LINE = 539883307;
    };
  };
}
