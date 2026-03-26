def format_datetime (): datetime -> string {
  $in | format date `%a, %b %d  %H:%M`
}

def main () {
  let output = date now | format_datetime
  sketchybar --set @name@ label=$"($output)"
}

