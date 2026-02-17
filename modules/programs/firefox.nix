{
  delib,
  host,
  pkgs,
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
              "github-repo" = {
                urls = [
                  {
                    template = "https://github.com/search?q={searchTerms}&type=repositories";
                  }
                ];
                icon = "https://github.githubassets.com/favicons/favicon.svg";
                definedAliases = ["@repo"];
              };
              "nixpkgs" = {
                urls = [
                  {
                    template = "https://search.nixos.org/packages?channel=unstable&query={searchTerms}";
                  }
                ];
                icon = "https://nixos.org/favicon.ico";
                definedAliases = ["@nixpkgs"];
              };
              "home-manager" = {
                urls = [
                  {
                    template = "https://home-manager-options.extranix.com/?query={searchTerms}&release=master";
                  }
                ];
                icon = "https://nixos.org/favicon.ico";
                definedAliases = ["@hm"];
              };
              "bing".metaData.hidden = true;
              "ddg".metaData.hidden = true;
            };
          };
          extensions = let
            getAddon = pname: pkgs.nur.repos.rycee.firefox-addons.${pname};
            proton-pass = getAddon "proton-pass";
          in {
            force = true;
            exhaustivePermissions = true;
            exactPermissions = true;
            packages = [
              proton-pass
            ];
            settings = {
              "${proton-pass.addonId}" = {
                permissions = proton-pass.meta.mozPermissions;
              };
            };
          };
          settings = {
            "sidebar.visibility" = "expand-on-hover";
            "sidebar.verticalTabs" = true;
            "browser.toolbars.bookmarks.visibility" = "never";
            "extensions.autoDisableScopes" = 0;
          };
        };
      };
    };
  };
}
