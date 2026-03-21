{
  delib,
  inputs,
  ...
}:
delib.overlayModule {
  name = "zed-extensions";

  overlay = inputs.zed-extensions.overlays.default;

  targets = ["home" "darwin"];
  enabled = true;
}
