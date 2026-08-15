# Rift appends the JSON event as argv[1]. The normalized environment is the
# stable callback contract, so the redundant JSON payload is intentionally ignored.
@sketchybar-exe@ --trigger workspace_change \
  "RIFT_WORKSPACE_NAME=${RIFT_WORKSPACE_NAME-}" \
  "RIFT_DISPLAY_UUID=${RIFT_DISPLAY_UUID-}" \
  "RIFT_SPACE_ID=${RIFT_SPACE_ID-}"
