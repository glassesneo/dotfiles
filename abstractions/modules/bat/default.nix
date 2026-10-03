{delib, ...}:
delib.module {
  name = "bat";
  meta.description = "Provide bat and configure its file display style.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: {
    packages = [pkgs.bat];

    xdg.config.files."bat/config" = {
      exclusive = true;
      text = ''
        --style="plain,changes"
        --number
      '';
    };
  };
}
