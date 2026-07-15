{delib, ...}:
delib.module {
  name = "programs.nvf.git";
  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nvf.settings.vim.git.gitsigns = {
    enable = true;
    codeActions.enable = false;
    setupOpts = {
      signs = {
        add.text = "┃";
        change.text = "┃";
        delete.text = "_";
        topdelete.text = "‾";
        changedelete.text = "~";
        untracked.text = "┆";
      };
      signcolumn = true;
      numhl = false;
      linehl = false;
      word_diff = false;
      current_line_blame = false;
      attach_to_untracked = false;
    };
    # The selected scope is signs only; disable nvf's hunk/blame mappings.
    mappings = {
      nextHunk = null;
      previousHunk = null;
      stageHunk = null;
      undoStageHunk = null;
      resetHunk = null;
      stageBuffer = null;
      resetBuffer = null;
      previewHunk = null;
      blameLine = null;
      toggleBlame = null;
      diffThis = null;
      diffProject = null;
      toggleDeleted = null;
    };
  };
}
