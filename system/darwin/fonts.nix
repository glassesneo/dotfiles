{
  pkgs,
  inputs,
  ...
}: {
  fonts = {
    packages = with pkgs; [
      nerd-fonts.hack
      hackgen-nf-font
      sketchybar-app-font
      # inputs.apple-fonts.packages.${pkgs.system}.sf-pro-nerd
    ];
  };
}
