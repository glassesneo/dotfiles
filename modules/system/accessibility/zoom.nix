{
  delib,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "system.accessibility.zoom";

  options.system.accessibility.zoom = with delib; {
    enable = boolOption pkgs.stdenv.isDarwin;
    pipWidth = readOnly (intOption 840);
    pipHeight = readOnly (intOption 480);
  };

  darwin.ifEnabled = {
    cfg,
    myconfig,
    ...
  }: {
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
      # PIP size is owned by UAZoomSettings, not a nix-darwin defaults type.
      # Activation runs as root (HOME=~root), so write it as the primary user.
      # AXVisualSupportAgent caches the frame in memory and only rereads it
      # on launch; terminate it after the write so launchd restarts it.
      activationScripts.zoomPipSize.text = ''
        sudo -u ${lib.escapeShellArg myconfig.constants.username} \
          /usr/bin/swift ${./zoom-pip.swift} \
          ${toString cfg.pipWidth} ${toString cfg.pipHeight}
        sudo -u ${lib.escapeShellArg myconfig.constants.username} \
          /usr/bin/killall AXVisualSupportAgent >/dev/null 2>&1 || true
      '';
    };
  };
}
