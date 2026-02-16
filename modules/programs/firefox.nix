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
                iconUdpateURL = "https://cdn.search.brave.com/serp/favicon.ico";
                definedAliases = ["@brave"];
              };
              "github-repo" = {
                urls = [
                  {
                    template = "https://github.com/search?q={searchTerms}&type=repositories";
                  }
                ];
                iconUdpateURL = "https://github.githubassets.com/favicons/favicon.svg";
                definedAliases = ["@repo"];
              };
              "nixpkgs" = {
                urls = [
                  {
                    template = "https://search.nixos.org/packages?channel=unstable&query={searchTerms}";
                  }
                ];
                iconUpdateURL = "https://nixos.org/favicon.ico";
                definedAliases = ["@nixpkgs"];
              };
              "home-manager" = {
                urls = [
                  {
                    template = "https://home-manager-options.extranix.com/?query={searchTerms}&release=master";
                  }
                ];
                iconUpdateURL = "https://nixos.org/favicon.ico";
                definedAliases = ["@hm"];
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
