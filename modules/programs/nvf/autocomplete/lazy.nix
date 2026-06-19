{delib, ...}:
delib.module {
  name = "programs.nvf.autocomplete";

  home.ifEnabled.programs.nvf.settings.vim = {
    lazy.plugins = {
      blink-cmp = {
        event = [
          "InsertEnter"
          "CmdlineEnter"
        ];
      };
    };
  };
}
