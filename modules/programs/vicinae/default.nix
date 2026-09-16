{
  applicationLauncher,
  delib,
  inputs,
  pkgs,
  ...
}:
delib.module {
  name = "programs.vicinae";

  options = with delib;
    moduleOptions {
      # Activation is derived from the shared application-launcher selector.
      enable = readOnly (boolOption applicationLauncher.isVicinae);
    };

  home.always.imports = [inputs.vicinae.homeManagerModules.default];

  home.ifEnabled = {
    programs.vicinae = {
      enable = true;
      # Compact/expand and list selection motion only; compact-mode logic stays upstream.
      package = inputs.vicinae.packages.${pkgs.stdenv.hostPlatform.system}.default.overrideAttrs (old: {
        patches =
          (old.patches or [])
          ++ [
            ./vicinae-compact-transition.patch
            ./vicinae-selection-highlight.patch
          ];
      });
      launchd.enable = pkgs.stdenv.isDarwin;
      settings = {
        # control means command key in macOS
        global_shortcuts.toggle = "control+space";
        escape_key_behavior = "navigate_back";
        pop_on_backspace = true;
        pop_to_root_on_close = true;
        close_on_focus_loss = true;
        activate_on_single_click = false;
        wrap_navigation = true;

        launcher_window = {
          material = "liquid_glass";
          rounding = 30;

          size = {
            width = 780;
            height = 500;
          };

          compact_mode.enabled = true;

          clock = {
            enabled = false;
            format = "HH:mm";
            interval = 60;
          };
        };

        tray.enabled = false;
      };
    };
  };
}
