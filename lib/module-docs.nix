# Render module metadata and declaration locations without generating a host.
{lib}: {
  configuration,
  root,
}: let
  escape = lib.replaceStrings ["&" "<" ">" "|" "\r\n" "\n" "\r"] ["&amp;" "&lt;" "&gt;" "&#124;" "<br>" "<br>" "<br>"];
  link = file: let
    path = lib.removePrefix "${toString root}/" (toString file);
    url = lib.concatMapStringsSep "/" lib.escapeURL (lib.splitString "/" path);
  in "[<code>${escape path}</code>](../../${url})";
  row = name: module: let
    declarations = builtins.filter (definition: builtins.hasAttr name definition.value) configuration.options.modules.definitionsWithLocations;
    paths = lib.unique (map (definition: definition.file) declarations);
  in "| <code>${escape name}</code> | ${escape module.meta.description} | ${lib.concatMapStringsSep "<br>" link paths} |";
in ''
  # Modules

  Generated from Denix module metadata. Do not edit; run `just docs`.

  | Module | Description | Source |
  | --- | --- | --- |
  ${lib.concatStringsSep "\n" (lib.mapAttrsToList row configuration.config.modules)}
''
