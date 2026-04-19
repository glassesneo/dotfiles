import os
import sys
import time

import tomlkit


def read_seed(path):
    with open(path, "r", encoding="utf-8") as seed_file:
        return tomlkit.parse(seed_file.read())


def read_existing(path):
    if not os.path.exists(path):
        return None

    try:
        with open(path, "r", encoding="utf-8") as existing_file:
            return tomlkit.parse(existing_file.read())
    except Exception as error:
        backup_path = f"{path}.invalid-{int(time.time())}"
        os.replace(path, backup_path)
        print(
            f"warning: ignored invalid Codex config {path}: {error}; "
            f"moved it to {backup_path}",
            file=sys.stderr,
        )
        return None


def preserve_runtime_table(seed, existing, table_name):
    runtime_table = existing.get(table_name)
    if not isinstance(runtime_table, tomlkit.items.Table):
        return

    if table_name not in seed:
        seed[table_name] = runtime_table
        return

    seed_table = seed[table_name]
    if not isinstance(seed_table, tomlkit.items.Table):
        return

    for key, value in runtime_table.items():
        if key not in seed_table:
            seed_table[key] = value


def merge(seed, existing):
    if existing is None:
        return seed

    preserve_runtime_table(seed, existing, "projects")
    preserve_runtime_table(seed, existing, "notice")

    if (
        "windows_wsl_setup_acknowledged" in existing
        and "windows_wsl_setup_acknowledged" not in seed
    ):
        seed["windows_wsl_setup_acknowledged"] = existing[
            "windows_wsl_setup_acknowledged"
        ]

    return seed


def write_output(path, document):
    tmp_path = f"{path}.tmp-{os.getpid()}"
    with open(tmp_path, "w", encoding="utf-8") as output_file:
        output_file.write(tomlkit.dumps(document))
    os.chmod(tmp_path, 0o600)
    os.replace(tmp_path, path)


def main():
    seed_path, existing_path, output_path = sys.argv[1:4]
    write_output(
        output_path,
        merge(read_seed(seed_path), read_existing(existing_path)),
    )


if __name__ == "__main__":
    main()
