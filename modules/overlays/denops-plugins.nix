{
  delib,
  inputs,
  ...
}:
delib.overlayModule {
  name = "denops-plugins";

  overlay = inputs.denops-plugins.overlays.default;

  targets = ["home" "darwin"];
  enabled = true;
}
