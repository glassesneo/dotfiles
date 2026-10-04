{delib, ...}:
delib.module {
  name = "publication";
  meta.description = "Centralize publication choices for feature-owned bundles.";
  options.enable = delib.boolOption true;

  bundles.ifEnabled.harness.publish = true;
}
