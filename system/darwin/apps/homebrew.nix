{
  homebrew = {
    enable = true;

    onActivation = {
      autoUpdate = false;
      # 'zap': uninstalls all formulae(and related files) not listed here.
      cleanup = "zap";
    };

    taps = [ "homebrew/services" ];

    # `brew install`
    brews = [
      "mas"
      "emscripten"
    ];

    # `brew install --cask`
    casks = [
      # "amazon-q"
      "arc"
      "canva"
      "chatgpt"
      "discord"
      "ghostty"
      "hot"
      "karabiner-elements"
      "keycastr"
      "kitty"
      "monitorcontrol"
      "notion"
      "one-switch"
      "orbstack"
      "proton-drive"
      "proton-pass"
      "raycast"
      "slack"
      "warp"
      "wave"
      "zoom"
      # "sketchybar"
    ];

    masApps = {
      XCode = 497799835;
      LINE = 539883307;
      RunCat = 1429033973;
      # Perplexity = 6714467650;
    };
  };
}
