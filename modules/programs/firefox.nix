{
  delib,
  host,
  ...
}:
delib.module {
  name = "programs.firefox";

  options = delib.singleEnableOption host.isDesktop;

  home.ifEnabled = {
    programs.firefox = {
      enable = true;
      profiles = {
        # Use both firefox sync and home-manager options. See: https://apribase.net/2025/04/12/nix-firefox-sync/
        default = {
          isDefault = true;
          search = {
            force = true;
            default = "brave";
            engines = {
              "brave" = {
                urls = [
                  {
                    template = "https://search.brave.com/search?q={searchTerms}";
                  }
                ];
                icon = "https://cdn.search.brave.com/serp/favicon.ico";
                definedAliases = ["@brave"];
              };
              "bing".metaData.hidden = true;
              "ddg".metaData.hidden = true;
            };
          };
          settings = {
            "sidebar.visibility" = "expand-on-hover";
            "sidebar.verticalTabs" = true;
            "browser.toolbars.bookmarks.visibility" = "never";
          };
        };
      };
    };
  };
}
