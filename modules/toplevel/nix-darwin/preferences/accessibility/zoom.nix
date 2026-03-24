{
  delib,
  pkgs,
  ...
}:
delib.module {
  name = "nix-darwin.preferences.accessibility.zoom";

  options.nix-darwin.preferences.accessibility.zoom = with delib; {
    enable = boolOption true;
    pipWidth = readOnly (intOption 2200);
    pipHeight = readOnly (intOption 1440);
  };

  darwin.ifEnabled = {cfg, ...}: {
    system = {
      defaults = {
        universalaccess = {
          closeViewScrollWheelToggle = true; # Enable scroll gesture with modifier keys to zoom
          closeViewZoomFollowsFocus = true; # Enable zoom to follow keyboard focus changes
        };
        CustomUserPreferences = {
          "com.apple.universalaccess" = {
            closeViewZoomMode = 1; # 1 = Picture-in-Picture
            closeViewPanningMode = 2; # Keep pointer centered while zoomed in
          };
        };
      };
      # Keyboard remap is owned by preferences/input.nix — not duplicated here.
      activationScripts.zoomPipSize.text = ''
        /usr/bin/swift -e '${builtins.readFile (pkgs.replaceVars ./zoom-pip.swift {
          pipWidth = toString cfg.pipWidth;
          pipHeight = toString cfg.pipHeight;
        })}'

        /usr/bin/killall cfprefsd SystemUIServer >/dev/null 2>&1 || true
      '';
    };
  };
}
