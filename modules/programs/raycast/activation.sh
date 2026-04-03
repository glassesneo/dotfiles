currentRaycastExe=@currentRaycastExe@
currentRaycastPrefix=@currentRaycastPrefix@
currentRaycastApp=@currentRaycastApp@

stale_found=0
current_running=0

while IFS=$'\t' read -r pid command; do
  [ -n "$pid" ] || continue
  [ -n "$command" ] || continue

  case "$command" in
  "$currentRaycastExe")
    current_running=1
    ;;
  "$currentRaycastPrefix"*) ;;
  */Applications/Raycast.app/Contents/*)
    stale_found=1
    /bin/kill "$pid" >/dev/null 2>&1 || true
    ;;
  esac
done < <(
  /bin/ps -axo pid=,command= |
    /usr/bin/awk '/\/Applications\/Raycast\.app\/Contents\// {
      pid = $1;
      $1 = "";
      sub(/^ +/, "", $0);
      print pid "\t" $0;
    }'
)

if [ "$stale_found" -eq 1 ] && [ "$current_running" -eq 0 ]; then
  /usr/bin/open -g -a "$currentRaycastApp" >/dev/null 2>&1 || true
fi
