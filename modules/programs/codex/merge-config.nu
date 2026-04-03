let seed = (open --raw $env.SEED_TOML | from toml)
let existing = (open --raw $env.EXISTING_TOML | from toml)

$existing | merge deep $seed | to toml | save -f $env.OUTPUT_TOML
