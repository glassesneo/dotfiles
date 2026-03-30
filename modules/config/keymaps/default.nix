# Shared semantic-action keymap registry.
# Defines editor-agnostic intents consumed by both Neovim and Zed modules.
# Editor-specific translation is owned by each editor's module.
{delib, ...}:
delib.module {
  name = "config.keymaps";

  myconfig.always.args.shared.keymaps = {
    # Each action: { key, modes, description }
    # modes uses Vim convention: "n" normal, "x" visual, "o" operator-pending

    goto-file-top = {
      key = "<Space>k";
      modes = ["n" "x" "o"];
      description = "Jump to the first line of the file";
    };

    goto-file-bottom = {
      key = "<Space>j";
      modes = ["n" "x" "o"];
      description = "Jump to the last line of the file";
    };

    goto-line-start = {
      key = "<Space>h";
      modes = ["n" "x" "o"];
      description = "Jump to the first non-whitespace character on the line";
    };

    goto-line-end = {
      key = "<Space>l";
      modes = ["n" "x" "o"];
      description = "Jump to the end of the line";
    };

    prev-buffer = {
      key = "<S-h>";
      modes = ["n"];
      description = "Switch to the previous buffer or tab";
    };

    next-buffer = {
      key = "<S-l>";
      modes = ["n"];
      description = "Switch to the next buffer or tab";
    };

    save-file = {
      key = "<Space>w";
      modes = ["n"];
      description = "Save the current file";
    };

    disable-macro-record = {
      key = "q";
      modes = ["n"];
      description = "Disable the default macro-record key";
    };

    match-bracket = {
      key = "M";
      modes = ["n" "x" "o"];
      description = "Jump to the matching bracket";
    };

    pane-left = {
      key = "<C-h>";
      modes = ["n" "x"];
      description = "Move focus to the pane on the left";
    };

    pane-down = {
      key = "<C-j>";
      modes = ["n" "x"];
      description = "Move focus to the pane below";
    };

    pane-up = {
      key = "<C-k>";
      modes = ["n" "x"];
      description = "Move focus to the pane above";
    };

    pane-right = {
      key = "<C-l>";
      modes = ["n" "x"];
      description = "Move focus to the pane on the right";
    };
  };
}
