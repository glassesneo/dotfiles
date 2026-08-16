while IFS= read -r pid; do
  [ -n "$pid" ] || continue
  /bin/kill "$pid" >/dev/null 2>&1 || true
done < <(
  /bin/ps -axo pid=,command= |
    /usr/bin/awk '/\/Applications\/Raycast\.app\/Contents\// { print $1 }'
)
