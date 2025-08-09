{
  delib,
  inputs,
  ...
}:
delib.module {
  name = "programs.nixvim";

  options.programs.nixvim = with delib; {
    enable = boolOption true;

    defaultEditor = boolOption true;
  };

  myconfig.always.args.shared.nixvimLib = inputs.nixvim.lib;

  home.always.imports = [inputs.nixvim.homeManagerModules.nixvim];

  home.ifEnabled.programs.nixvim = {cfg, ...}: {
    enable = true;
    inherit (cfg) defaultEditor;
    # extraConfigLuaPre = builtins.readFile ./config.lua;
    # extraPackages = with pkgs; [
    # deno
    # efm-langserver
    # stylua
    # alejandra
    # ];
    withNodeJs = false;
    withPerl = false;
    withPython3 = false;
    withRuby = false;
    autoCmd = [
      {
        event = "TextYankPost";
        pattern = ["*"];
        callback.__raw = ''
          function()
            vim.hl.on_yank({ timeout = 300 })
          end
        '';
      }
    ];
  };
}
