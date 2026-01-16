{
  delib,
  pkgs,
  ...
}: let
  # The nickel source directory containing all .ncl files
  # Path relative from modules/config/ -> ../../nickel
  nickelSrc = ../../nickel;

  # Helper function to import a Nickel file and convert to Nix attrset
  # mainFile is relative to nickelSrc
  importNickel = mainFile:
    builtins.fromJSON (builtins.readFile (
      pkgs.runCommand "nickel-export" {
        nativeBuildInputs = [pkgs.nickel];
      } ''
        cd ${nickelSrc}
        nickel export ${mainFile} > $out
      ''
    ));
in
  delib.module {
    name = "lib.nickel";

    myconfig.always.args.shared.nickelLib = {
      inherit importNickel;

      # Import with a specific field selector
      importNickelField = mainFile: field:
        (importNickel mainFile).${field};
    };
  }
