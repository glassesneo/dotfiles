import os
from pathlib import Path
import subprocess
import sys
import tempfile

hooks = sys.argv[1]


def git(*args, check=True, env=None):
    return subprocess.run(
        ["git", *args], text=True, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, check=check, env=env,
    )


def fixture():
    directory = tempfile.TemporaryDirectory()
    os.chdir(directory.name)
    git("init", "-q")
    git("config", "user.email", "test@example.invalid")
    git("config", "user.name", "Test")
    Path("sample.nix").write_text("original\n")
    Path("obsolete.txt").write_text("obsolete\n")
    Path(".gitignore").write_text("ignored\n")
    git("add", ".")
    git("commit", "-qm", "initial")
    git("config", "core.hooksPath", hooks)
    Path("sample.nix").write_text("needs formatting\n")
    git("add", "sample.nix")
    return directory


for dirty in ("unstaged", "untracked"):
    with fixture():
        if dirty == "unstaged":
            Path("sample.nix").write_text("keep this unstaged edit\n")
        else:
            Path("untracked").write_text("keep this new file\n")
        before_index = git("write-tree").stdout
        before_status = git("status", "--porcelain").stdout
        before_diff = git("diff").stdout
        result = git("commit", "-m", "blocked", check=False)
        assert result.returncode != 0, result.stdout
        assert dirty in result.stdout.lower(), result.stdout
        assert git("write-tree").stdout == before_index
        assert git("status", "--porcelain").stdout == before_status
        assert git("diff").stdout == before_diff
        assert not Path(".git/nix-calls").exists()

for fail_check in (False, True):
    with fixture():
        Path("ignored").write_text("not part of the commit\n")
        Path("user-change.txt").write_text("already staged\n")
        git("add", "user-change.txt")
        before_head = git("rev-parse", "HEAD").stdout
        env = dict(os.environ)
        if fail_check:
            env["FAIL_CHECK"] = "1"
        result = git("commit", "-m", "automated", check=False, env=env)
        assert (result.returncode != 0) == fail_check, result.stdout
        assert Path(".git/nix-calls").read_text() == "fmt\nbuild\nflake\n"
        assert "sample.nix" in result.stdout, result.stdout
        assert "hook-new.txt" in result.stdout, result.stdout
        assert not any("user-change.txt" in line and "|" in line
                       for line in result.stdout.splitlines()), result.stdout
        assert git("show", ":sample.nix").stdout == "formatted\n"
        assert git("show", ":docs/generated/modules.md").stdout == "generated catalogue\n"
        assert git("show", ":hook-new.txt").stdout == "created by hook\n"
        assert git("ls-files", "obsolete.txt", "ignored").stdout == ""
        assert git("diff").stdout == ""
        if fail_check:
            assert git("rev-parse", "HEAD").stdout == before_head
            assert git("diff", "--cached", "--name-only").stdout
        else:
            assert git("status", "--porcelain").stdout == ""
            assert git("show", "HEAD:docs/generated/modules.md").stdout == "generated catalogue\n"

with fixture():
    result = git("commit", "-m", "format failure", check=False,
                 env=dict(os.environ, FAIL_FMT="1"))
    assert result.returncode != 0, result.stdout
    assert Path(".git/nix-calls").read_text() == "fmt\n"
    assert Path("sample.nix").read_text() == "formatted\n"
    assert git("show", ":sample.nix").stdout == "needs formatting\n"
