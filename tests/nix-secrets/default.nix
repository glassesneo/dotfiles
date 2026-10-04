{
  inputs,
  pkgs,
  system,
}: let
  makeSystem = (import ../../adapters/hjem {inherit inputs;}).moduleSystems.hjem.makeSystem;
  evaluate = modules:
    makeSystem {
      inherit modules;
      extraArgs = {
        inherit system;
        username = "fixture";
        homeDirectory = "/tmp/nix-secrets-fixture";
      };
    };
  enabled = automatic: extraPackages:
    import ./fixture.nix {
      inherit inputs;
      username = "fixture";
      homeDirectory = "/tmp/nix-secrets-fixture";
      extraModules = [
        {
          security.nix-secrets = {
            activate.enable = automatic;
            defaultGroup = 20;
            inherit extraPackages;
          };
        }
      ];
    };
  fixture = enabled true [pkgs.coreutils];
  on = fixture.result;
  off = evaluate [];
  manual = (enabled false []).result;
  defaultPath = (enabled true []).result.serviceApply;
  production =
    (evaluate [
      {
        security.nix-secrets = {
          enable = true;
          installPackage = false;
          storage = "/tmp/nix-secrets-fixture/storage";
          secrets.dummy = {};
        };
      }
    ]).serviceApply;
  source = name: (pkgs.lib.findFirst (file: pkgs.lib.hasSuffix "/${name}" file.target) (throw "Missing fixture output") on.manifest.files).source;
  manifest = source "manifest.json";
  cliEnvironment = source "cli-env.json";
in
  # Owns compatibility wiring: disabled/manual-only configurations must not
  # register a job, while automatic activation hands the upstream manifest to
  # the user backend. Existing Hjem checks own generic plist/lifecycle behavior.
  # Given real ciphertext, activation with a missing key must publish nothing;
  # a forged marker on an ordinary directory must not bypass RAM verification.
  # These material failure paths are not detected by evaluation/builds. Native
  # read-only mount inspection works in the Darwin sandbox: no jobs or images.
  pkgs.runCommand "nix-secrets-wiring-test" {
    nativeBuildInputs = [pkgs.python3 pkgs.nushell];
    probe = fixture.probe;
    age = "${pkgs.age}/bin/age";
    inherit manifest cliEnvironment defaultPath production;
    automatic = on.serviceApply;
    disabled = off.serviceApply;
    manualOnly = manual.serviceApply;
  } ''
    nu --no-config-file -c 'use std/assert; assert (nu-check --debug ${../../scripts/nix-secrets-smoke.nu})'
    python3 - <<'PY'
    import json, os, re, shlex, subprocess, tempfile
    from pathlib import Path
    assert json.loads((Path(os.environ['disabled']) / 'services.json').read_text()) == []
    assert json.loads((Path(os.environ['manualOnly']) / 'services.json').read_text()) == []
    manifest = json.loads(Path(os.environ['manifest']).read_text())
    environment = json.loads(Path(os.environ['cliEnvironment']).read_text())
    command = shlex.split(environment['NIX_SECRETS_NIX_EVAL_COMMAND'])
    assert json.loads(subprocess.check_output(command)) == manifest
    assert environment['NIX_SECRETS_GENERATOR_BUILD_COMMAND'].startswith('${pkgs.nix}/bin/nix-store ')
    assert manifest['moduleSystem'] == 'hjem'
    assert manifest['identityPaths'] == ['/tmp/nix-secrets-fixture/key.txt']
    secret, = manifest['secrets']
    assert secret['owner'] == 'fixture' and secret['group'] == 20 and secret['mode'] == '0400'
    job, = json.loads((Path(os.environ['automatic']) / 'services.json').read_text())
    assert job['domain'] == 'gui' and job['restart']
    assert job['label'] == job['config']['Label'] == 'org.hjem.nix-secrets-probe'
    production_job, = json.loads((Path(os.environ['production']) / 'services.json').read_text())
    assert production_job['label'] == 'org.hjem.nix-secrets-activate'
    assert production_job['label'] != job['label']
    assert job['config']['RunAtLoad'] and job['runAtLoad'] and not job['config'].get('KeepAlive', False)
    script = Path(job['config']['ProgramArguments'][0]).read_text()
    assert ' activate ' in script and '--needed-for-users false' in script
    assert re.search(r'^exec /usr/bin/lockf -k \S+/nix-secrets/activate.lock ', script, re.M)
    activation_manifest = re.search(r' activate (\S+) --needed-for-users', script)[1]
    assert json.loads(Path(activation_manifest).read_text()) == manifest
    def wrapper_path(job):
        wrapper = Path(job['config']['ProgramArguments'][0]).read_text()
        value = re.search(r'^\s*export PATH=(.*)$', wrapper, re.M)[1]
        return shlex.split(value)[0].split(':')

    assert wrapper_path(job) == ['${pkgs.coreutils}/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
    default_job, = json.loads((Path(os.environ['defaultPath']) / 'services.json').read_text())
    assert wrapper_path(default_job) == ['/usr/bin', '/bin', '/usr/sbin', '/sbin']

    # Use a real ciphertext: a missing storage file would test the wrong failure.
    probe = Path(os.environ['probe'])
    with tempfile.TemporaryDirectory() as directory:
        home = Path(directory)
        key = home / 'key.txt'
        subprocess.run([str(probe / 'keygen'), '-o', str(key)], check=True, capture_output=True)
        recipient = re.search(r'^# public key: (.+)$', key.read_text(), re.M)[1]
        storage = home / 'storage'
        storage.mkdir()
        subprocess.run([os.environ['age'], '-r', recipient, '-o', str(storage / 'dummy.enc')],
                       input=b'dummy-missing-key', check=True, capture_output=True)
        saved = home / 'key.saved'
        key.rename(saved)
        manifest.update(storage=str(storage), identityPaths=[str(key)], generationsDir=str(home / 'generations'))
        secret['path'] = str(home / 'published')
        manifest_path = home / 'manifest.json'
        manifest_path.write_text(json.dumps(manifest))
        package = re.search(r' (\S+)/bin/nix-secrets activate ', script)[1]
        failed = subprocess.run([package + '/bin/nix-secrets', 'activate', str(manifest_path),
                                 '--needed-for-users', 'false'], capture_output=True, text=True)
        assert failed.returncode != 0 and 'Failed to decrypt secret' in failed.stderr
        assert not (home / 'published').exists() and not (home / 'generations').exists()

        # A forged marker needs no real mount: native read-only inspection can
        # reject this ordinary directory inside the sandbox.
        saved.rename(key)
        generations = home / 'generations'
        generations.mkdir()
        anchor = generations / 'nix-secrets-anchor'
        anchor.touch()
        native = subprocess.run(['/sbin/mount'], capture_output=True, text=True)
        assert native.returncode == 0, native.stderr
        environment = dict(os.environ, PATH='/usr/bin:/bin:/usr/sbin:/sbin')
        failed = subprocess.run([package + '/bin/nix-secrets', 'activate', str(manifest_path),
                                 '--needed-for-users', 'false'], env=environment, capture_output=True, text=True)
        assert failed.returncode != 0 and 'Failed to check for secret generation existence' in failed.stderr, failed.stderr
        assert list(generations.iterdir()) == [anchor] and not (home / 'published').exists()
    PY
    touch "$out"
  ''
