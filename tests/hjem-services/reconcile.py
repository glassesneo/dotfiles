"""Journal boundary checks: upstream launchctl is trusted, not emulated semantically.
Given desired generations and failures, consumers observe safe retry, no takeover,
GUI deferral, disabled-job preservation and closure retention. No upstream check
covers this repository-owned state machine; filesystem outcomes are stable.
"""
import importlib.util
import json
from pathlib import Path
import tempfile

spec = importlib.util.spec_from_file_location("services", __import__('sys').argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Ctl:
    def __init__(self):
        self.jobs = set()
        self.starts = 0
        self.restarts = 0
        self.gui = False
        self.disable = False
        self.fail = False

    def available(self, domain):
        return not domain.startswith('gui') or self.gui

    def loaded(self, domain, label, path):
        return (domain, label) in self.jobs

    def disabled(self, *args):
        return self.disable

    def bootout(self, domain, label):
        self.jobs.remove((domain, label))

    def bootstrap(self, domain, path):
        if self.fail:
            raise RuntimeError('injected failure')
        self.jobs.add((domain, path.stem))
        self.starts += 1

    def restart(self, *args):
        self.restarts += 1


# Consumer diagnostic parsing is repository-owned: real launchctl uses
# enabled/disabled, while some OS releases expose boolean tokens.
class Diagnostic(m.Launchctl):
    def __init__(self, text):
        self.text = text
    def run(self, *args, **kwargs):
        return type('Result', (), {'stdout': self.text, 'returncode': 0})()

for token in ('true', 'disabled', 'false', 'enabled'):
    assert Diagnostic('"org.test" => ' + token).disabled('user/1', 'org.test') == (token in ('true', 'disabled'))
assert not Diagnostic('"org.test.other" => disabled').disabled('user/1', 'org.test')
assert Diagnostic('job = {\n path = /home/agent.plist\n}').loaded('user/1', 'org.test', Path('/home/agent.plist'))
try:
    Diagnostic('job = {\n path = /foreign/agent.plist\n}').loaded('user/1', 'org.test', Path('/home/agent.plist'))
    assert False
except RuntimeError:
    pass

with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    home = tmp / 'home'
    ctl = Ctl()
    fake = tmp / 'nix-store'
    fake.write_text('#!/bin/sh\nln -sfn "$5" "$2"\n')
    fake.chmod(0o755)

    def generation(n, jobs):
        p = tmp / ('generation-' + str(n))
        (p / 'plists').mkdir(parents=True)
        (p / 'services.json').write_text(json.dumps(jobs))
        for job in jobs:
            (p / 'plists' / (job['label'] + '.plist')).write_text(str(n))
        return p

    job = dict(name='test', label='org.hjem.test', domain='user', restart=False, runAtLoad=False)
    one = generation(1, [job])
    def apply(p):
        m.reconcile(p, home, str(fake), ctl)
    apply(one)
    apply(one)
    assert ctl.starts == 1 and ctl.restarts == 0
    ctl.jobs.clear()
    apply(one)
    assert ctl.starts == 2
    two = generation(2, [dict(job, restart=True)])
    ctl.fail = True
    try:
        apply(two)
        assert False
    except RuntimeError:
        pass
    roots = list((home / '.local/state/hjem/services').glob('root-*'))
    assert {r.resolve() for r in roots} == {one, two}
    ctl.fail = False
    apply(two)
    apply(two)
    assert {r.resolve() for r in (home / '.local/state/hjem/services').glob('root-*')} == {two}
    assert ctl.restarts == 2
    ctl.disable = True
    ctl.jobs.clear()
    apply(two)
    assert not ctl.jobs and ctl.restarts == 2
    ctl.disable = False
    gui = generation(3, [dict(job, domain='gui')])
    apply(gui)
    assert not ctl.jobs
    assert (home / 'Library/LaunchAgents/org.hjem.test.plist').exists()
    ctl.gui = True
    apply(gui)
    assert len(ctl.jobs) == 1
    ctl.gui = False
    gui_update = generation(5, [dict(job, domain='gui')])
    apply(gui_update)
    assert (home / 'Library/LaunchAgents/org.hjem.test.plist').read_text() == '5'
    empty = generation(4, [])
    apply(empty)
    assert not (home / 'Library/LaunchAgents/org.hjem.test.plist').exists()
    assert 'generation-3' in (home / '.local/state/hjem/services/state.json').read_text()
    removed_path = home / 'Library/LaunchAgents/org.hjem.test.plist'
    removed_path.write_text('unmanaged after removal')
    try:
        apply(empty)
        assert False
    except RuntimeError:
        pass
    assert removed_path.read_text() == 'unmanaged after removal'
    removed_path.unlink()
    ctl.gui = True
    apply(empty)
    assert not ctl.jobs
    assert json.loads((home / '.local/state/hjem/services/state.json').read_text()) == []
    target = home / 'Library/LaunchAgents/org.hjem.test.plist'
    target.write_text('unmanaged')
    try:
        apply(one)
        assert False
    except RuntimeError:
        pass
    assert target.read_text() == 'unmanaged'
    target.unlink()
    apply(one)
    target.write_text('manual edit')
    try:
        apply(empty)
        assert False
    except RuntimeError:
        pass
    assert target.read_text() == 'manual edit'
    target.unlink()
    apply(empty)
    ctl.jobs.add((f'gui/{m.os.getuid()}', job['label']))
    try:
        apply(one)
        assert False
    except RuntimeError:
        pass
    assert not target.exists()

    # Model APFS filename aliasing at filesystem operations, regardless of the
    # check runner's filesystem. Keep label/path spelling intact for launchctl.
    class CaseInsensitiveAgents(type(Path())):
        def __fspath__(self):
            value = super().__fspath__()
            if self.parent.name == 'LaunchAgents' and self.suffix == '.plist':
                return str(self.parent / self.name.lower())
            return value

    alias_home = CaseInsensitiveAgents(tmp / 'alias-home')
    ctl = Ctl()
    ctl.gui = True
    upper = dict(job, label='Org.Test', domain='gui')
    lower = dict(job, label='org.test', domain='user')
    old_alias = generation(6, [upper])
    new_alias = generation(7, [lower])
    def alias_apply(p):
        m.reconcile(p, alias_home, str(fake), ctl)
    alias_apply(old_alias)
    ctl.gui = False
    alias_apply(new_alias)
    upper_path = alias_home / 'Library/LaunchAgents/Org.Test.plist'
    lower_path = alias_home / 'Library/LaunchAgents/org.test.plist'
    assert upper_path.exists() and upper_path.read_text() == lower_path.read_text() == '7'
    alias_apply(new_alias)  # Retry while old GUI identity is still deferred.
    lower_path.write_text('manual case-alias edit')
    ctl.gui = True
    before = set(ctl.jobs)
    try:
        alias_apply(new_alias)
        assert False
    except RuntimeError:
        pass
    assert ctl.jobs == before and lower_path.read_text() == 'manual case-alias edit'
    lower_path.write_text('7')
    alias_apply(new_alias)
    assert ctl.jobs == {(f'user/{m.os.getuid()}', 'org.test')}
    assert lower_path.read_text() == '7'
    alias_state = alias_home / '.local/state/hjem/services'
    assert len(json.loads((alias_state / 'state.json').read_text())) == 1
    assert {r.resolve() for r in alias_state.glob('root-*')} == {new_alias}
    alias_apply(empty)
    assert not ctl.jobs and not upper_path.exists() and not lower_path.exists()

# RunAtLoad starts a just-bootstrapped job, so a restart would interrupt that
# run; a job that was already loaded, or does not run at load, is restarted.
with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    ctl = Ctl()
    fake = tmp / 'nix-store'
    fake.write_text('#!/bin/sh\nln -sfn "$5" "$2"\n')
    fake.chmod(0o755)

    def generation(n, jobs):
        p = tmp / ('generation-' + str(n))
        (p / 'plists').mkdir(parents=True)
        (p / 'services.json').write_text(json.dumps(jobs))
        for job in jobs:
            (p / 'plists' / (job['label'] + '.plist')).write_text(str(n))
        return p

    def apply(p, home='load'):
        m.reconcile(p, tmp / home, str(fake), ctl)

    loading = dict(name='test', label='org.hjem.test', domain='user', restart=True, runAtLoad=True)
    first = generation(1, [loading])
    apply(first)
    assert ctl.starts == 1 and ctl.restarts == 0
    apply(first)
    assert ctl.starts == 1 and ctl.restarts == 1
    apply(generation(2, [loading]))  # Changed content is bootstrapped again.
    assert ctl.starts == 2 and ctl.restarts == 1

    ctl.jobs.clear()
    apply(generation(3, [dict(loading, runAtLoad=False)]), home='manual')
    assert ctl.starts == 3 and ctl.restarts == 2
