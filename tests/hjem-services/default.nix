{
  inputs,
  pkgs,
  system,
}: let
  lib = pkgs.lib;
  makeSystem = (import ../../adapters/hjem {inherit inputs;}).moduleSystems.hjem.makeSystem;
  result = modules:
    makeSystem {
      inherit modules;
      extraArgs = {
        inherit system;
        username = "fixture";
        homeDirectory = "/tmp/hjem-services-fixture";
      };
    };
  good = result [
    {
      userServices.example = {
        command = ["${pkgs.coreutils}/bin/true" "literal $arg"];
        environment.A = "a";
      };
      platform.darwin.launchAgents = {
        example = {
          domain = "user";
          config.EnvironmentVariables.B = "b";
        };
        native = {
          domain = "gui";
          config = {
            Program = "${pkgs.coreutils}/bin/true";
            Label = "fixture.native";
          };
        };
      };
    }
  ];
  # Evaluation is the lowest boundary for duplicate/identity rejection. Plistlib
  # validates serialization separately; runtime checks own lifecycle transitions.
  rejected = module: !(builtins.tryEval (builtins.deepSeq (result [module]).serviceApply true)).success;
  base = {userServices.x.command = ["/bin/true"];};
  bad = extra:
    lib.recursiveUpdate base {
      platform.darwin.launchAgents.x = {
        domain = "user";
        config = extra;
      };
    };
  linuxResult = module:
    lib.evalModules {
      specialArgs = {
        inherit lib;
        pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;
      };
      modules = [
        ../../adapters/hjem/services.nix
        {
          options.directory = lib.mkOption {
            type = lib.types.str;
            default = "/tmp/fixture";
          };
          config = module;
        }
      ];
    };
in
  assert !(builtins.tryEval (linuxResult base).config.serviceApply.drvPath).success;
  assert (builtins.tryEval
    (linuxResult {
      platform.darwin.launchAgents.native = {
        domain = "gui";
        config.Program = "/bin/true";
      };
    }).config.serviceApply.drvPath).success;
  assert rejected {
    platform.darwin.launchAgents = {
      a = {
        domain = "user";
        config = {
          Label = "Org.Test";
          Program = "/bin/true";
        };
      };
      b = {
        domain = "gui";
        config = {
          Label = "org.test";
          Program = "/bin/true";
        };
      };
    };
  };
  assert rejected {
    assertions = [
      {
        assertion = false;
        message = "fixture";
      }
    ];
  };
  assert rejected (lib.recursiveUpdate (bad {EnvironmentVariables.A = "same";}) {userServices.x.environment.A = "same";});
  assert rejected (lib.recursiveUpdate (bad {WorkingDirectory = "/tmp";}) {userServices.x.workingDirectory = "/tmp";});
  assert rejected (bad {ProgramArguments = ["relative"];});
  assert rejected (bad {ProgramArguments = ["/bin/true"];});
  assert rejected (bad {Program = "/bin/true";});
  assert rejected (bad {RunAtLoad = true;});
  assert rejected (bad {Label = "../unsafe";});
  assert rejected (bad {LimitLoadToSessionType = "Aqua";});
  assert rejected {userServices.x.command = [];};
  assert rejected (lib.recursiveUpdate base {
    platform.darwin.launchAgents.x = {
      domain = "user";
      restartOnSwitch = false;
    };
  });
  assert rejected {
    platform.darwin.launchAgents = {
      a = {
        domain = "user";
        config = {
          Label = "same";
          Program = "/bin/true";
        };
      };
      b = {
        domain = "gui";
        config = {
          Label = "same";
          Program = "/bin/true";
        };
      };
    };
  };
    pkgs.runCommand "hjem-services-test" {
      nativeBuildInputs = [pkgs.python3];
      services = good.serviceApply;
    } ''
      python3 ${./reconcile.py} ${../../adapters/hjem/services.py}
      python3 - "$services" <<'PY'
      import pathlib, plistlib, sys
      plists = [plistlib.loads(p.read_bytes()) for p in (pathlib.Path(sys.argv[1]) / 'plists').glob('*.plist')]
      portable = next(p for p in plists if 'ProgramArguments' in p)
      assert portable['ProgramArguments'][1] == 'literal $arg'
      assert portable['EnvironmentVariables'] == {'A': 'a', 'B': 'b'}
      assert portable['RunAtLoad'] is True
      assert portable['LimitLoadToSessionType'] == 'Background'
      PY
      touch "$out"
    ''
