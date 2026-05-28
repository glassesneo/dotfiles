{
  delib,
  inputs,
  ...
}:
delib.overlayModule {
  name = "nur";

  overlay = inputs.nur.overlays.default;

  targets = ["home" "darwin" "nixos"];
  enabled = true;
}
