import os
from pathlib import Path
import subprocess
import sys

command = sys.argv[1]
with Path(".git/nix-calls").open("a") as log:
    log.write(command + "\n")

if command == "fmt":
    Path("sample.nix").write_text("formatted\n")
    Path("hook-new.txt").write_text("created by hook\n")
    Path("obsolete.txt").unlink(missing_ok=True)
    if os.environ.get("FAIL_FMT"):
        sys.exit(1)
elif command == "build":
    output = Path(".git/catalogue").resolve()
    output.write_text("generated catalogue\n")
    print(output)
elif command == "flake":
    subprocess.run(["git", "diff", "--exit-code"], check=True)
    assert subprocess.check_output(
        ["git", "show", ":docs/generated/modules.md"], text=True
    ) == "generated catalogue\n"
    if os.environ.get("FAIL_CHECK"):
        sys.exit(1)
else:
    raise AssertionError(sys.argv)
