{delib, ...}:
delib.module {
  name = "programs.nvf.autocomplete";

  home.ifEnabled = {cfg, ...}: {
    programs.nvf.settings.vim = {
      lazy.plugins = {
        blink-cmp = {
          event = [
            "InsertEnter"
            "CmdlineEnter"
          ];
          after =
            builtins.replaceStrings
            ["@source_priority_json@"]
            [(builtins.toJSON cfg.source_priority)]
            (builtins.readFile ./after.lua);
        };
      };
    };
  };
}
