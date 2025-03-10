{pkgs, ...}: {
  programs.zed-editor = {
    enable = true;
    extensions = [
      "catppuccin"
      "deno"
      "lua"
      "nim"
      "nix"
      "nu"
      "zig"
    ];
    extraPackages = with pkgs; [
      nil
      alejandra
      deno
      zls
    ];
    installRemoteServer = true;
    userKeymaps = [
      {
        context = "Editor && (vim_mode == normal) && !VimWaiting";
        bindings = {
          "shift-h" = "pane::ActivatePrevItem";
          "shift-l" = "pane::ActivateNextItem";
          "space d" = "terminal_panel::ToggleFocus";
          "space f" = "project_panel::ToggleFocus";
        };
      }
      {
        context = "vim_mode == normal && !menu";
        bindings = {
          shift-y = ["workspace::SendKeystrokes" "y $"];
        };
      }
      {
        context = "Editor && (vim_mode == insert) && !VimWaiting";
        bindings = {
          "j j" = "vim::NormalBefore";
        };
      }
      {
        context = "Editor && edit_prediction && (vim_mode == insert) && !VimWaiting";
        bindings = {
          "ctrl-y" = "editor::AcceptEditPrediction";
        };
      }
      # {
      #   context = "Terminal";
      #
      # }
    ];
    userSettings = {
      vim_mode = true;
      vim = {
        use_smartcase_find = true;
      };
      theme = "Iosevka";
      "experimental.theme_overrides" = {
        "background.appearance" = "transparent";
        "editor.background" = "#00000000";
        "panel.background" = "#00000000";
      };
      ui_font_size = 15;
      buffer_font_size = 15;
      buffer_font_family = "HackGen35 Console NF";
      scrollbar.show = "never";
      buffer_line_height.custom = 1.5;
      inlay_hints = {
        enabled = true;
        show_type_hints = true;
        show_parameter_hints = true;
        show_other_hints = true;
        edit_debounce_ms = 700;
        scroll_debounce_ms = 50;
      };
      languages = {
        Nix = {
          language_servers = ["nil" "!nixd"];
          # formatter.external.command = "alejandra -";
        };
      };
      lsp = {
        nil = {
          initialization_options = {
            formatting.command = ["alejandra" "-"];
          };
          settings = {
            # diagnostics.ignored = ["unused_binding"];
          };
        };
      };
      tabs = {
        git_status = true;
        show_close_button = "hidden";
      };
      terminal = {
        alternate_scroll = "off";
        blinking = "terminal_controlled";
        copy_on_select = true;
        font_family = "JetBrainsMono Nerd Font";
        toolbar = {
          title = true;
        };
        line_height.custom = 1.5;
        working_directory = "current_project_directory";
      };
    };
  };
}
