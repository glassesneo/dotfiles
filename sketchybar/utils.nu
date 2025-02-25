#!/usr/bin/env nu
use std log

export def list_to_args (): list<string> -> string {
  $in | str join ' '
}
