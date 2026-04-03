config_file='@configFile@'
backup_file='@backupFile@'
tmp_file="$config_file.tmp"

mkdir -p "$(dirname "$config_file")"

if [ -s "$backup_file" ]; then
  SEED_TOML="$config_file" \
    EXISTING_TOML="$backup_file" \
    OUTPUT_TOML="$tmp_file" \
    @nu@ @mergeNuScript@
else
  cp "$config_file" "$tmp_file"
fi

rm -f "$backup_file"
rm -f "$config_file"
mv "$tmp_file" "$config_file"
