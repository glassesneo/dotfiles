# Owns Hjem user-service declarations and Darwin lowering. Portable argv is never
# interpreted by a shell. Native additions may add leaves, never replace them.
# Lifecycle and ownership are implemented by services.py, not nix-darwin.
{
  config,
  lib,
  pkgs,
  ...
}: let
  inherit (lib) mkOption types;
  absolute = types.addCheck types.str (s: lib.hasPrefix "/" s && !lib.hasInfix "\n" s);
  argv = types.addCheck (types.listOf types.str) (xs: xs != [] && lib.hasPrefix "/" (builtins.head xs));
  plist = types.anything;
  portable = types.submodule {
    options = {
      command = mkOption {
        type = types.uniq argv;
        description = "Nonempty argv with an absolute executable; no shell expansion.";
      };
      autoStart = mkOption {
        type = types.bool;
        default = true;
        description = "Start whenever launchd loads the job: on registration and at each login, not on every switch.";
      };
      restartOnSwitch = mkOption {
        type = types.bool;
        default = false;
        description = "Request a potentially interrupting restart on every switch, except right after registration has started an autoStart job.";
      };
      environment = mkOption {
        type = types.attrsOf types.str;
        default = {};
        description = "Explicit service environment; session inheritance is not guaranteed.";
      };
      workingDirectory = mkOption {
        type = types.nullOr absolute;
        default = null;
        description = "Absolute working directory, when specified.";
      };
    };
  };
  native = types.submodule ({options, ...}: {
    config.policyDefined = lib.any (definition: !(lib.elem definition.file options.restartOnSwitch.declarations)) options.restartOnSwitch.definitionsWithLocations;
    options = {
      policyDefined = mkOption {
        type = types.bool;
        internal = true;
        readOnly = true;
        description = "Whether native restart policy was explicitly declared.";
      };
      domain = mkOption {
        type = types.enum ["user" "gui"];
        description = "Launchctl domain; GUI registration is deferred without a GUI session.";
      };
      config = mkOption {
        type = types.attrsOf plist;
        default = {};
        description = "Plist-compatible native additions; identity, executable and session fields are validated.";
      };
      restartOnSwitch = mkOption {
        type = types.bool;
        default = false;
        description = "Native-only switch restart policy; cannot also be defined by a portable declaration.";
      };
    };
  });
  fail = message: throw "Hjem user services: ${message}";
  merge = path: a: b:
    lib.foldlAttrs (acc: key: value:
      acc
      // {
        ${key} =
          if !(builtins.hasAttr key acc)
          then value
          else if builtins.isAttrs acc.${key} && builtins.isAttrs value
          then merge "${path}.${key}" acc.${key} value
          else fail "duplicate ${path}.${key}";
      })
    a
    b;
  validValue = v:
    builtins.isString v
    || builtins.isBool v
    || builtins.isInt v
    || builtins.isFloat v
    || (builtins.isList v && lib.all validValue v)
    || (builtins.isAttrs v && lib.all validValue (builtins.attrValues v));
  safeLabel = s: builtins.isString s && builtins.match "[A-Za-z0-9][A-Za-z0-9._-]*" s != null;
  jobs = lib.mapAttrs (name: _: let
    p = config.userServices.${name} or null;
    n = config.platform.darwin.launchAgents.${name} or null;
    domain =
      if n == null
      then "user"
      else n.domain;
    extra =
      if n == null
      then {}
      else n.config;
    base =
      if p == null
      then {}
      else
        {
          ProgramArguments = p.command;
          RunAtLoad = p.autoStart;
        }
        // lib.optionalAttrs (p.environment != {}) {EnvironmentVariables = p.environment;}
        // lib.optionalAttrs (p.workingDirectory != null) {WorkingDirectory = p.workingDirectory;};
    merged = merge name base extra;
    label = merged.Label or "org.hjem.${builtins.hashString "sha256" name}";
    session =
      if domain == "user"
      then "Background"
      else "Aqua";
    program = merged.Program or (builtins.head (merged.ProgramArguments or [""]));
    args = merged.ProgramArguments or [];
    checks =
      safeLabel label
      && validValue merged
      && builtins.isString program
      && lib.hasPrefix "/" program
      && builtins.isList args
      && lib.all builtins.isString args
      && (!(merged ? ProgramArguments) || args != [])
      && (!(merged ? WorkingDirectory) || (builtins.isString merged.WorkingDirectory && lib.hasPrefix "/" merged.WorkingDirectory))
      && (!(merged ? EnvironmentVariables) || (builtins.isAttrs merged.EnvironmentVariables && lib.all builtins.isString (builtins.attrValues merged.EnvironmentVariables)))
      && (!(merged ? RunAtLoad) || builtins.isBool merged.RunAtLoad)
      && (!(merged ? LimitLoadToSessionType) || merged.LimitLoadToSessionType == session || merged.LimitLoadToSessionType == [session]);
  in
    if p != null && extra ? Program
    then fail "${name}: portable command conflicts with Program"
    else if p != null && n != null && n.policyDefined
    then fail "${name}: duplicate restartOnSwitch policy"
    else if !checks
    then fail "${name}: invalid plist identity, executable or session"
    else {
      inherit name label domain;
      restart =
        if p != null
        then p.restartOnSwitch
        else n.restartOnSwitch;
      runAtLoad = merged.RunAtLoad or false;
      config =
        merged
        // {
          Label = label;
          LimitLoadToSessionType = session;
        };
    }) (config.userServices // config.platform.darwin.launchAgents);
  # Darwin homes commonly use case-insensitive APFS; identities must also be
  # unique as owned filenames, not merely as launchd label strings.
  labels = map (job: lib.toLower job.label) (builtins.attrValues jobs);
  data =
    if builtins.length labels != builtins.length (lib.unique labels)
    then fail "duplicate Label"
    else builtins.toJSON (builtins.attrValues jobs);
  manifest = pkgs.writeText "hjem-services.json" data;
  services =
    if !pkgs.stdenv.hostPlatform.isDarwin
    then
      if config.userServices != {}
      then fail "Linux user-service backend is not implemented"
      else pkgs.writeShellScriptBin "apply" "exit 0"
    else
      pkgs.runCommand "hjem-services" {nativeBuildInputs = [pkgs.python3];} ''
        mkdir -p "$out/bin" "$out/plists"
        cp ${manifest} "$out/services.json"
        python3 - "$out" <<'PY'
        import json, plistlib, sys, pathlib
        out = pathlib.Path(sys.argv[1])
        for job in json.loads((out / 'services.json').read_text()):
            (out / 'plists' / (job['label'] + '.plist')).write_bytes(plistlib.dumps(job['config']))
        PY
        cat > "$out/bin/apply" <<'EOF'
        #!${pkgs.runtimeShell}
        exec ${pkgs.python3}/bin/python3 ${./services.py} "$(cd "$(${pkgs.coreutils}/bin/dirname "$0")/.." && pwd)" ${lib.escapeShellArg config.directory} ${pkgs.nix}/bin/nix-store
        EOF
        chmod +x "$out/bin/apply"
      '';
in {
  options = {
    userServices = mkOption {
      type = types.attrsOf portable;
      default = {};
      description = "Portable Hjem-owned user services; currently implemented on Darwin only.";
    };
    platform.darwin.launchAgents = mkOption {
      type = types.attrsOf native;
      default = {};
      description = "Hjem-owned native LaunchAgents, optionally adding to portable jobs of the same name.";
    };
    serviceApply = mkOption {
      type = types.package;
      internal = true;
      readOnly = true;
      description = "Service closure with bin/apply, invoked after standalone file/package activation.";
    };
  };
  config.serviceApply = services;
}
