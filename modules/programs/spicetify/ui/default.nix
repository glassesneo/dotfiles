{
  delib,
  spicePkgs,
  ...
}:
delib.module {
  name = "programs.spicetify.ui";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = {
    programs.spicetify = {
      enabledExtensions = with spicePkgs.extensions; [
        betterGenres
        hidePodcasts
        sidebarCustomizer
        volumePercentage
        spicyLyrics
      ];
    };
  };
}
