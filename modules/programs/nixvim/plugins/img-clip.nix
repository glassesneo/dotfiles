{
  delib,
  homeConfig,
  lib,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.img-clip";

  options = delib.singleEnableOption true;

  home.ifEnabled.programs.nixvim = {
    plugins.img-clip = {
      enable = true;
      lazyLoad = {
        enable = true;
        settings = {
          cmd = ["PasteImage"];
        };
      };
      settings = {
        filetypes = {
          codecompanion = lib.mkIf homeConfig.programs.nixvim.plugins.codecompanion.enable {
            prompt_for_file_name = false;
            template = "[Image]($FILE_PATH)";
            use_absolute_path = true;
          };
        };
      };
    };
    extraPackages =
      if pkgs.stdenv.isDarwin
      then [
        pkgs.pngpaste
      ]
      else [];
  };
}
