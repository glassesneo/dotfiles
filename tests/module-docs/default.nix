# Check catalogue freshness against real metadata. Synthetic metadata also checks
# that names are sorted and source links remain relative and Markdown-safe;
# Nix's option validation cannot detect broken rendered links or table cells.
{
  pkgs,
  configuration,
}: let
  inherit (pkgs) lib;
  render = import ../../lib/module-docs.nix {inherit lib;};
  catalogue = pkgs.writeText "modules.md" (render {
    inherit configuration;
    root = ../..;
  });
  example = render {
    root = "/repo";
    configuration = {
      config.modules = {
        z.meta.description = "Last";
        a.meta.description = "A | B\n<detail>";
      };
      options.modules.definitionsWithLocations = [
        {
          file = "/repo/modules/a space/default.nix";
          value.a = {};
        }
        {
          file = "/repo/modules/z/default.nix";
          value.z = {};
        }
      ];
    };
  };
in
  assert lib.hasInfix "A &#124; B<br>&lt;detail&gt;" example;
  assert lib.hasInfix "(../../modules/a%20space/default.nix)" example;
  assert map (line: builtins.substring 8 1 line) (builtins.filter (lib.hasPrefix "| <code>") (lib.splitString "\n" example)) == ["a" "z"];
    pkgs.runCommand "module-docs-current" {} ''
      diff -u ${../../docs/generated/modules.md} ${catalogue}
      touch "$out"
    ''
