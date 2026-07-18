use std/log

def main [direction: string] {
  const name = "@name@"
  log info $"Rendering ($name)"
  ^@script-path@ render $direction
}
