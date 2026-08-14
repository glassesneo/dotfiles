{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "user.fonts";

  options = delib.singleEnableOption host.guiShellFeatured;

  home.ifEnabled = {
    fonts.fontconfig.enable = true;

    home.packages = with pkgs; [
      udev-gothic-nf
      plemoljp-nf

      # japanese
      noto-fonts-cjk-serif
      noto-fonts-cjk-sans

      # nerd fonts
      hackgen-nf-font
    ];
  };
}
