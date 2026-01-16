{
  delib,
  homeConfig,
  ...
}:
delib.module {
  name = "programs.zellij";

  options.programs.zellij = with delib; {
    enable = boolOption false;
  };

  home.ifEnabled = {
    programs.zellij = {
      enable = true;
    };
    xdg.configFile = {
      "zellij/config.kdl".text = ''
        default_layout "compact"
        pane_frames false
        ui {
            pane_frames {
                rounded_corners false
            }
        }
        show_startup_tips false
        keybinds clear-defaults=true {
            normal {
                bind "Shift Super h" { MoveFocus "Left"; }
                bind "Shift Super j" { MoveFocus "Down"; }
                bind "Shift Super k" { MoveFocus "Up"; }
                bind "Shift Super l" { MoveFocus "Right"; }
                bind "Super t" { NewPane; }
                bind "Shift Super t" {
                  NewTab {
                    cwd "${homeConfig.home.homeDirectory}"
                  }
                }
                bind "Shift Super ." { GoToNextTab; }
                bind "Shift Super ," { GoToPreviousTab; }
                bind "Super d" { Detach; }
                bind "Super f" { ToggleFloatingPanes; }
            }
        }
      '';
    };
  };
}
