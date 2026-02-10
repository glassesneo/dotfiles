#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fixture_dir="${script_dir}/fixtures/negative"

fixtures=(
  "01-bad-enabled-key.ncl"
  "02-both-url-and-command-id.ncl"
  "03-neither-url-nor-command-id.ncl"
  "04-needs-node-without-command-id.ncl"
)

expected_messages=(
  "enabled target references unknown servers"
  'must define exactly one of `url` or `command_id`'
  'must define exactly one of `url` or `command_id`'
  'needs_node=true requires `command_id`'
)

failures=0

for i in "${!fixtures[@]}"; do
  fixture_path="${fixture_dir}/${fixtures[$i]}"
  expected_message="${expected_messages[$i]}"
  stderr_file="$(mktemp)"

  if nickel export "${fixture_path}" > /dev/null 2>"${stderr_file}"; then
    echo "FAIL: ${fixtures[$i]} exported successfully; expected failure"
    failures=$((failures + 1))
  elif rg --fixed-strings --quiet "${expected_message}" "${stderr_file}"; then
    echo "PASS: ${fixtures[$i]} failed with expected message"
  else
    echo "FAIL: ${fixtures[$i]} failed without expected message"
    echo "      expected substring: ${expected_message}"
    failures=$((failures + 1))
  fi

  rm -f "${stderr_file}"
done

if (( failures > 0 )); then
  echo "Fixture checks failed: ${failures} failing case(s)"
  exit 1
fi

echo "All negative fixtures failed as expected"
