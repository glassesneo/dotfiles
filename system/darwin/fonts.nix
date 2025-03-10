{pkgs, ...}: {
  fonts = {
    packages = with pkgs; [
      nerd-fonts.hack
      nerd-fonts.iosevka
      hackgen-nf-font
      sketchybar-app-font
    ];
  };
}
