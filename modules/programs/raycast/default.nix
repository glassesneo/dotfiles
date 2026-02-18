{
  delib,
  host,
  pkgs,
  ...
}:
delib.module {
  name = "programs.raycast";

  options = delib.singleEnableOption host.guiShellFeatured;

  home.ifEnabled = {
    home.packages = let
      raycast-quick-edit-kitty = pkgs.writeShellApplication {
        name = "raycast-quick-edit";
        runtimeInputs = with pkgs; [kitty vim coreutils];
        text = builtins.readFile ./quick-edit-kitty.sh;
      };

      raycast-quick-edit-ghostty = pkgs.writeShellApplication {
        name = "raycast-quick-edit-ghostty";
        runtimeInputs = with pkgs; [vim coreutils];
        text = builtins.readFile ./quick-edit-ghostty.sh;
      };
    in [
      raycast-quick-edit-kitty
      raycast-quick-edit-ghostty
    ];
  };
}
