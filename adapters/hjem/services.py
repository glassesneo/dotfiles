"""Owns serialized, retryable user LaunchAgent reconciliation.

State is a write-ahead ownership journal, not evidence inferred from files.
Generation roots are retained until no journal entry can require that closure.
No global rollback: successful operations remain after an error.

Python supplies fcntl.flock, whose kernel lock is released when the file closes
or the process exits, and mkstemp, file fsync and atomic replace for journal and
plist writes. No directory fsync is performed, so full power-loss durability is
not guaranteed.
"""
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


def atomic(path, data):
    fd, temp = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temp, 0o600)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


class Launchctl:
    def run(self, *args, check=False):
        result = subprocess.run(["/bin/launchctl", *args], text=True, capture_output=True)
        if check and result.returncode:
            raise RuntimeError(result.stderr or result.stdout)
        return result

    def available(self, domain):
        return self.run("print", domain).returncode == 0

    def loaded(self, domain, label, path):
        result = self.run("print", f"{domain}/{label}")
        if result.returncode:
            # A readable domain distinguishes an absent job from a domain error.
            if not self.available(domain):
                raise RuntimeError(f"Cannot inspect {domain}")
            return False
        paths = re.findall(r"^\s*path = (.+)$", result.stdout, re.M)
        if paths != [str(path)]:
            raise RuntimeError(f"Unmanaged or ambiguous loaded job: {domain}/{label}")
        return True

    def disabled(self, domain, label):
        output = self.run("print-disabled", domain, check=True).stdout
        matches = re.findall(r'^\s*"' + re.escape(label) + r'"\s*=>\s*(true|false|disabled|enabled)\s*$', output, re.M)
        return any(value in ("true", "disabled") for value in matches)

    def bootout(self, domain, label):
        self.run("bootout", f"{domain}/{label}", check=True)

    def bootstrap(self, domain, path):
        self.run("bootstrap", domain, str(path), check=True)

    def restart(self, domain, label):
        self.run("kickstart", "-k", f"{domain}/{label}", check=True)


def reconcile(closure, home, nix_store, ctl):
    state = home / ".local/state/hjem/services"
    agents = home / "Library/LaunchAgents"
    for directory in (state, agents):
        directory.mkdir(parents=True, exist_ok=True)
        if directory.is_symlink() or directory.stat().st_uid != os.getuid():
            raise RuntimeError(f"Unsafe owned directory: {directory}")
    os.chmod(state, 0o700)
    lock = state / "lock"
    if lock.is_symlink():
        raise RuntimeError("Unsafe lock")
    with lock.open("a") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        apply_locked(closure, state, agents, nix_store, ctl)


def apply_locked(closure, state, agents, nix_store, ctl):
    journal = state / "state.json"
    if journal.is_symlink():
        raise RuntimeError("Unsafe journal")
    records = json.loads(journal.read_text()) if journal.exists() else []
    desired = json.loads((closure / "services.json").read_text())
    root = state / ("root-" + closure.name)
    if root.is_symlink() and root.resolve() != closure:
        raise RuntimeError("Unexpected GC root")
    subprocess.run([nix_store, "--add-root", str(root), "--indirect", "--realise", str(closure)], check=True, stdout=subprocess.DEVNULL)

    def save():
        atomic(journal, json.dumps(records).encode())

    def domain(record):
        return f"{record['domain']}/{os.getuid()}"

    def verify_file(record):
        path = agents / (record["label"] + ".plist")
        if path.is_symlink() or (path.exists() and (path.stat().st_uid != os.getuid() or path.read_text() != record["content"])):
            raise RuntimeError(f"Refusing modified/unmanaged file: {path}")
        return path

    # Verify all existing ownership before changing intent or stopping jobs.
    for record in records:
        if not record.get("retired"):
            verify_file(record)
        # Labels are ASCII and Nix rejects lowercased filename collisions.
        # Across generations an active case alias can own a retired path;
        # its content is still verified by the active-record branch above.
        elif not any(r["label"].lower() == record["label"].lower() and not r.get("retired") for r in records):
            path = agents / (record["label"] + ".plist")
            if path.exists() or path.is_symlink():
                raise RuntimeError(f"Refusing file created after managed removal: {path}")
    wanted = []
    for job in desired:
        wanted.append({"name": job["name"], "label": job["label"], "domain": job["domain"],
                       "content": (closure / "plists" / (job["label"] + ".plist")).read_text(),
                       "root": str(root), "restart": job["restart"], "runAtLoad": job["runAtLoad"],
                       "remove": False})
    # A label in the other domain is not ours merely because its path matches.
    # Inspect both readable domains before file or live-job mutation. Owned old
    # identities are permitted here so domain migration can retire them below.
    identities = {(r["domain"], r["label"]) for r in records}
    for label in {r["label"] for r in records + wanted}:
        for kind in ("user", "gui"):
            dom = f"{kind}/{os.getuid()}"
            if ctl.available(dom) and ctl.loaded(dom, label, agents / (label + ".plist")):
                if (kind, label) not in identities:
                    raise RuntimeError(f"Refusing unmanaged job: {dom}/{label}")
    for record in records:
        record["remove"] = record.get("retired", False) or not any(all(record[k] == new[k] for k in ("name", "label", "domain", "content")) for new in wanted)
    save()

    # Retire old identities first. GUI absence preserves the journal and roots.
    for record in list(records):
        if not record["remove"]:
            continue
        path = agents / (record["label"] + ".plist") if record.get("retired") else verify_file(record)
        dom = domain(record)
        available = ctl.available(dom)
        if available and ctl.loaded(dom, record["label"], path):
            ctl.bootout(dom, record["label"])
        if not record.get("retired"):
            if path.exists():
                path.unlink()
            record["retired"] = True
            save()
        if not available:
            if record["domain"] != "gui":
                raise RuntimeError(f"Unavailable {dom}")
            print(f"Deferred GUI removal: {record['label']}")
            continue
        records.remove(record)
        save()

    for new in wanted:
        record = next((r for r in records if r["name"] == new["name"] and not r["remove"]), None)
        path = agents / (new["label"] + ".plist")
        dom = domain(new)
        available = ctl.available(dom)
        if not available and new["domain"] != "gui":
            raise RuntimeError(f"Unavailable {dom}")
        if record is None:
            if path.exists() or path.is_symlink():
                raise RuntimeError(f"Refusing unmanaged file: {path}")
            if available and ctl.loaded(dom, new["label"], path):
                raise RuntimeError(f"Refusing unmanaged job: {new['label']}")
            records.append(new)
            record = new
            save()  # Ownership before installation makes interrupted copies retryable.
        verify_file(record)
        if not path.exists():
            atomic(path, new["content"].encode())
        else:
            os.chmod(path, 0o600)
        if not available:
            print(f"Deferred GUI registration: {new['label']}")
            continue
        if ctl.disabled(dom, new["label"]):
            print(f"Manually disabled, startup skipped: {new['label']}")
            continue
        bootstrapped = not ctl.loaded(dom, new["label"], path)
        if bootstrapped:
            ctl.bootstrap(dom, path)
        # RunAtLoad already started a just-bootstrapped job; kickstart -k would kill that run midway.
        if new["restart"] and not (bootstrapped and new["runAtLoad"]):
            ctl.restart(dom, new["label"])
        record.update(new)
        save()

    # Deferred and failed entries still reference their old roots; desired intent
    # also remains rooted even when a replacement could not yet be installed.
    keep = {r["root"] for r in records} | {str(root)}
    for old in state.glob("root-*"):
        if str(old) not in keep:
            old.unlink()


if __name__ == "__main__":
    try:
        reconcile(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], Launchctl())
    except Exception as error:
        print(f"Hjem services: {error}", file=sys.stderr)
        sys.exit(1)
