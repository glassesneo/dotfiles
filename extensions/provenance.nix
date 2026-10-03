# Owns the origin labels of module and host sections.
#
# Every `always`, `ifEnabled`, and `ifDisabled` section of every module system
# is labelled `<module|host> <name> (<system>.<section>)`. The module system
# reports the label as the location of each definition the section makes, in
# error messages and in `definitionsWithLocations`. Mechanisms that need to
# tell definitions apart by origin rely on these labels.
{
  delib,
  lib,
  config,
  ...
}: let
  sections = ["always" "ifEnabled" "ifDisabled"];

  # Denix keeps an entry's `_file`, but coercion has already set it to
  # <unknown-file>, so the label replaces it.
  label = kind: name: moduleSystem: section: entry: let
    labelled = delib.toDenixArgs (args:
      delib.processModule
      (module: module // {_file = "${kind} ${name} (${moduleSystem}.${section})";})
      (delib.callIfDenixArgs entry args));
  in
    if lib.isFunction entry
    then delib.inheritFunctionArgs entry labelled
    else labelled;

  labelSections = kind: {name, ...}: {
    options = lib.genAttrs (builtins.attrNames config.moduleSystems) (moduleSystem:
      lib.genAttrs sections (section:
        lib.mkOption {
          apply = map (label kind name moduleSystem section);
        }));
  };
in {
  settings.modules.extraSubmodules = labelSections "module";
  settings.hosts.extraSubmodules = labelSections "host";
}
