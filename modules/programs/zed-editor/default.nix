{
  delib,
  homeConfig,
  host,
  inputs,
  keymaps,
  lib,
  llm-agents,
  pkgs,
  ...
}: let
  # Zed-specific action translations for shared semantic actions.
  # Only actions with clear Zed equivalents are listed.
  zedActions = {
    goto-file-top = {
      context = "VimControl && !menu";
      action = ["workspace::SendKeystrokes" "g g"];
    };
    goto-file-bottom = {
      context = "VimControl && !menu";
      action = ["workspace::SendKeystrokes" "shift-g"];
    };
    goto-line-start = {
      context = "VimControl && !menu";
      action = "vim::FirstNonWhitespace";
    };
    goto-line-end = {
      context = "VimControl && !menu";
      action = "vim::EndOfLine";
    };
    prev-buffer = {
      context = "vim_mode == normal && !menu";
      action = "pane::ActivatePrevItem";
    };
    next-buffer = {
      context = "vim_mode == normal && !menu";
      action = "pane::ActivateNextItem";
    };
    save-file = {
      context = "vim_mode == normal && !menu";
      action = "workspace::Save";
    };
    disable-macro-record = {
      context = "vim_mode == normal && !menu";
      action = null; # unbind
    };
    match-bracket = {
      context = "VimControl && !menu";
      action = ["workspace::SendKeystrokes" "%"];
    };
    pane-left = {
      context = "VimControl && !menu";
      action = ["workspace::SendKeystrokes" "ctrl-w h"];
    };
    pane-down = {
      context = "VimControl && !menu";
      action = ["workspace::SendKeystrokes" "ctrl-w j"];
    };
    pane-up = {
      context = "VimControl && !menu";
      action = ["workspace::SendKeystrokes" "ctrl-w k"];
    };
    pane-right = {
      context = "VimControl && !menu";
      action = ["workspace::SendKeystrokes" "ctrl-w l"];
    };
  };

  # Convert Vim key notation to Zed keymap notation.
  # "<Space>h" → "space h", "<S-l>" → "shift-l", "<C-h>" → "ctrl-h"
  # Single uppercase letter "M" → "shift-m"
  upperToLower =
    builtins.listToAttrs
    (builtins.genList (i: {
        name = builtins.substring i 1 "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        value = builtins.substring i 1 "abcdefghijklmnopqrstuvwxyz";
      })
      26);

  toZedKey = key: let
    replaced =
      builtins.replaceStrings
      ["<Space>" "<S-" "<C-" ">"]
      ["space " "shift-" "ctrl-" ""]
      key;
  in
    if builtins.stringLength replaced == 1 && upperToLower ? ${replaced}
    then "shift-${upperToLower.${replaced}}"
    else replaced;

  # Group actions by context, then build keymap entries
  mkZedKeymaps = let
    actionNames = builtins.attrNames zedActions;
    mkEntry = name: let
      action = zedActions.${name};
      key = toZedKey keymaps.${name}.key;
    in {
      inherit (action) context;
      key = key;
      value = action.action;
    };
    entries = map mkEntry actionNames;
    # Group entries by context
    contexts =
      builtins.foldl' (
        acc: entry:
          acc
          // {
            ${entry.context} =
              (acc.${entry.context} or [])
              ++ [entry];
          }
      ) {}
      entries;
  in
    builtins.attrValues (builtins.mapAttrs (
        ctx: ctxEntries: {
          context = ctx;
          bindings = builtins.listToAttrs (
            map (e: {
              name = e.key;
              value = e.value;
            })
            ctxEntries
          );
        }
      )
      contexts);

  codexEnabled = homeConfig.programs.codex.enable;
  claudeCodeEnabled = homeConfig.programs.claude-code.enable;

  zedAgentPackages =
    (lib.optional codexEnabled homeConfig.programs.codex.package)
    ++ (lib.optional claudeCodeEnabled homeConfig.programs.claude-code.package);

  zedAgentServers =
    (lib.optionalAttrs codexEnabled {
      "Codex" = {
        type = "custom";
        command = lib.getExe llm-agents."codex-acp";
        args = [];
        env = {};
      };
    })
    // (lib.optionalAttrs claudeCodeEnabled {
      "Claude-Code" = {
        type = "custom";
        command = lib.getExe llm-agents."claude-code-acp";
        args = [];
        env = {
          CLAUDE_CODE_EXECUTABLE = lib.getExe' homeConfig.programs.claude-code.package "claude";
        };
      };
    });
in
  delib.module {
    name = "programs.zed-editor";

    options = delib.singleEnableOption host.guiShellFeatured;

    home.always.imports = [
      inputs.zed-extensions.homeManagerModules.default
    ];

    home.ifEnabled = {
      programs.zed-editor = {
        enable = true;
        extraPackages =
          (with pkgs; [
            nixd
          ])
          ++ zedAgentPackages;
        mutableUserSettings = false;
        userSettings =
          {
            vim_mode = true;
            agent = {
              tool_permissions = {
                default = "allow";
              };
            };
            "experimental.theme_overrides" = {
              "background" = "#000000b5";
              "background.appearance" = "blurred";
              "editor.background" = "#00000000";
              "editor.gutter.background" = "#00000000";
              "panel.background" = "#00000000";
              "surface.background" = "#00000090";
              "elevated_surface.background" = "#000000f0";
              "tab_bar.background" = "#00000000";
              "tab.inactive_background" = "#00000000";
              "tab.active_background" = "#3f3f4650";
              "toolbar.background" = "#00000000";
              "status_bar.background" = "#00000090";
              "title_bar.background" = "#00000070";
            };
          }
          // lib.optionalAttrs (zedAgentServers != {}) {
            agent_servers = zedAgentServers;
          };
        userKeymaps =
          mkZedKeymaps
          ++ [
            # jj to escape insert mode (matches Neovim behavior)
            {
              context = "vim_mode == insert";
              bindings = {
                "j j" = "vim::NormalBefore";
              };
            }
            # Preserve AquaSKK toggles inside insert-mode editing.
            # This overrides the shared Vim pane-navigation bindings only while
            # typing, so normal/visual mode Ctrl-h/j/k/l still navigates panes.
            {
              context = "Editor && vim_mode == insert";
              bindings = {
                "ctrl-j" = null;
                "ctrl-l" = null;
                "ctrl-a" = [
                  "editor::MoveToBeginningOfLine"
                  {
                    stop_at_soft_wraps = false;
                  }
                ];
                "ctrl-e" = [
                  "editor::MoveToEndOfLine"
                  {
                    stop_at_soft_wraps = false;
                  }
                ];
                "ctrl-b" = "editor::MoveLeft";
                "ctrl-f" = "editor::MoveRight";
              };
            }
            # If an edit prediction is visible, prefer accepting it with Ctrl-e.
            # Otherwise the generic insert-mode Ctrl-e binding above moves to
            # the end of the line.
            {
              context = "Editor && vim_mode == insert && edit_prediction";
              bindings = {
                "ctrl-e" = "editor::AcceptEditPrediction";
              };
            }
            {
              context = "Editor && vim_mode == insert && showing_completions";
              bindings = {
                "ctrl-p" = "editor::ContextMenuPrevious";
                "ctrl-n" = "editor::ContextMenuNext";
                "ctrl-y" = "editor::ConfirmCompletion";
                "tab" = null;
              };
            }
            {
              context = "Editor && vim_mode == insert && showing_completions && edit_prediction_conflict";
              bindings = {
                "ctrl-p" = "editor::ContextMenuPrevious";
                "ctrl-n" = "editor::ContextMenuNext";
                "ctrl-y" = "editor::ConfirmCompletion";
                "ctrl-e" = null;
              };
            }
            # AgentPanel covers the whole panel; AgentPanel > Editor targets
            # the message editor specifically where IME input happens.
            {
              context = "AgentPanel > Editor";
              bindings = {
                "ctrl-j" = null;
                "ctrl-l" = null;
                "ctrl-a" = [
                  "editor::MoveToBeginningOfLine"
                  {
                    stop_at_soft_wraps = false;
                  }
                ];
                "ctrl-e" = [
                  "editor::MoveToEndOfLine"
                  {
                    stop_at_soft_wraps = false;
                  }
                ];
                "ctrl-b" = "editor::MoveLeft";
                "ctrl-f" = "editor::MoveRight";
              };
            }
            {
              context = "AgentPanel";
              bindings = {
                "ctrl-j" = null;
                "ctrl-l" = null;
              };
            }
            {
              bindings = {
                "cmd-shift-a" = "agent::ToggleFocus";
                "cmd-b" = "project_panel::Toggle";
              };
            }
          ];
      };
      programs.zed-editor-extensions = {
        enable = true;
        packages = with pkgs.zed-extensions; [
          nix
          zig
        ];
      };
    };
  }
