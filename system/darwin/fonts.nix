{pkgs, ...}: {
  fonts = {
    packages = with pkgs; [
      nerd-fonts.hack
      nerd-fonts.iosevka
      udev-gothic
      udev-gothic-nf
      hackgen-nf-font
      sketchybar-app-font
    ];
  };
}
