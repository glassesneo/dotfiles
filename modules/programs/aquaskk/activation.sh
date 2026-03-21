_aquaskk_plist="$HOME/Library/Preferences/jp.sourceforge.inputmethod.aquaskk.plist"
_aquaskk_domain="jp.sourceforge.inputmethod.aquaskk"

# Create user dictionary parent directory before AquaSKK first use
$DRY_RUN_CMD mkdir -p "@userDictDir@"

# --- AquaSKK preference seeding ---
if [ -L "$_aquaskk_plist" ]; then
  # A symlink still exists after linkGeneration — this is non-legacy
  # protected state (e.g. manually placed or from another manager).
  # Preserve it and warn the user.
  echo "WARNING: $_aquaskk_plist is a symlink after linkGeneration."
  echo "AquaSKK preferences cannot be seeded while a symlink is in place."
  echo "To fix: remove or back up the symlink, then re-run activation."
  echo "  rm \"$_aquaskk_plist\""
  echo "  nh home switch"
elif [ -n "$DRY_RUN_CMD" ]; then
  $VERBOSE_ECHO "Dry run: would seed AquaSKK preferences via defaults write"
else
  # Seed startup-safe keys into the AquaSKK domain.
  # Uses additive writes so unrelated user/UI-managed settings persist.
  $VERBOSE_ECHO "Seeding AquaSKK preferences into $_aquaskk_domain..."
  /usr/bin/defaults write "$_aquaskk_domain" user_dictionary_path -string "@user_dictionary_path@"
  /usr/bin/defaults write "$_aquaskk_domain" keyboard_layout -string "@keyboard_layout@"
  /usr/bin/defaults write "$_aquaskk_domain" enable_skkserv -int @enable_skkserv@
  /usr/bin/defaults write "$_aquaskk_domain" skkserv_port -int @skkserv_port@
  /usr/bin/defaults write "$_aquaskk_domain" skkserv_localonly -int @skkserv_localonly@
  /usr/bin/defaults write "$_aquaskk_domain" suppress_newline_on_commit -int @suppress_newline_on_commit@
  /usr/bin/defaults write "$_aquaskk_domain" fix_intermediate_conversion -int @fix_intermediate_conversion@
  /usr/bin/defaults write "$_aquaskk_domain" use_numeric_conversion -int @use_numeric_conversion@
  /usr/bin/defaults write "$_aquaskk_domain" show_input_mode_icon -int @show_input_mode_icon@
  /usr/bin/defaults write "$_aquaskk_domain" delete_okuri_when_quit -int @delete_okuri_when_quit@
  /usr/bin/defaults write "$_aquaskk_domain" enable_annotation -int @enable_annotation@
  /usr/bin/defaults write "$_aquaskk_domain" enable_dynamic_completion -int @enable_dynamic_completion@
  /usr/bin/defaults write "$_aquaskk_domain" enable_extended_completion -int @enable_extended_completion@
  /usr/bin/defaults write "$_aquaskk_domain" dynamic_completion_range -int @dynamic_completion_range@
  /usr/bin/defaults write "$_aquaskk_domain" max_count_of_inline_candidates -int @max_count_of_inline_candidates@
  /usr/bin/defaults write "$_aquaskk_domain" candidate_window_font_name -string "@candidate_window_font_name@"
  /usr/bin/defaults write "$_aquaskk_domain" candidate_window_font_size -int @candidate_window_font_size@
  /usr/bin/defaults write "$_aquaskk_domain" candidate_window_labels -string "@candidate_window_labels@"
  /usr/bin/defaults write "$_aquaskk_domain" put_candidate_window_upward -int @put_candidate_window_upward@
  /usr/bin/defaults write "$_aquaskk_domain" use_individual_input_mode -int @use_individual_input_mode@
  /usr/bin/defaults write "$_aquaskk_domain" direct_clients -array @directClientsArgs@

  # Verify the domain is readable by CFPreferences
  if /usr/bin/defaults read "$_aquaskk_domain" user_dictionary_path >/dev/null 2>&1; then
    $VERBOSE_ECHO "AquaSKK preferences domain is readable."
  else
    echo "WARNING: defaults read failed for $_aquaskk_domain after seeding."
    echo "AquaSKK may not start correctly. Try: defaults read $_aquaskk_domain"
  fi
fi
