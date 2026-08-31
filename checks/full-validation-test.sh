#!/usr/bin/env bash
# Behavioral test admission: the runner owns check inventory and retained-root
# transitions. A stale or partially replaced current generation can make later
# validation roots unavailable, which Nix evaluation and shell syntax checks do
# not observe. Given fake Nix inventory/build results at the runner boundary,
# the consumer observes the complete build inventory and either an atomically
# advanced current generation or the unchanged prior generation after failure.
# This small fake-backed check is proportionate to that persistence risk and
# intentionally does not assert timing or duplicate Nix realization coverage.
set -euo pipefail

runner_source=${1:?usage: full-validation-test.sh RUNNER_SOURCE}
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

fail() {
  echo "full-validation test failure: $*" >&2
  exit 1
}

assert_contains() {
  local haystack=$1
  local needle=$2

  [[ $haystack == *"$needle"* ]] || fail "expected $needle"
}

assert_values_exactly_once() {
  local actual_name=$1
  local expected_name=$2
  local actual_value
  local expected_value
  local matches
  local -n actual_values=$actual_name
  local -n expected_values=$expected_name

  [[ ${#actual_values[@]} -eq ${#expected_values[@]} ]] || fail "expected ${#expected_values[@]} values, got ${#actual_values[@]}"
  for expected_value in "${expected_values[@]}"; do
    matches=0
    for actual_value in "${actual_values[@]}"; do
      [[ $actual_value == "$expected_value" ]] && ((matches += 1))
    done
    [[ $matches -eq 1 ]] || fail "expected exactly one $expected_value"
  done
}

runner_contents=$(<"$runner_source")
fake_bin="$tmpdir/bin"
mkdir -p "$fake_bin"

printf '#!%s\n' "$BASH" >"$fake_bin/nix"
cat >>"$fake_bin/nix" <<'FAKE_NIX'
set -euo pipefail

counter_file="$NIX_LOG_DIR/counter"
call_number=0
if [[ -f $counter_file ]]; then
  read -r call_number <"$counter_file"
fi
call_number=$((call_number + 1))
printf '%s\n' "$call_number" >"$counter_file"
printf '%s\0' "$@" >"$NIX_LOG_DIR/$call_number"

case "${1:-}" in
flake)
  [[ "${2:-}" == check ]]
  ;;
eval)
  if [[ "${!#}" == ".#checks.$NIX_SYSTEM" ]]; then
    case "${NIX_INVENTORY:-normal}" in
    normal)
      printf '%s\n' '"alpha"' '"line\nname"' '"quote\"name"' '"space name"'
      ;;
    empty)
      ;;
    *)
      exit 65
      ;;
    esac
  elif [[ "${!#}" == .#checks.aarch64-linux.nixos-seiran-vm0.drvPath ]]; then
    printf '/nix/store/incompatible.drv'
  else
    exit 66
  fi
  ;;
build)
  [[ "${NIX_BUILD_RESULT:-success}" == success ]] || exit 42
  out_link=""
  while (($#)); do
    case "$1" in
    --out-link)
      out_link=$2
      shift 2
      ;;
    *)
      shift
      ;;
    esac
  done
  [[ -n $out_link ]]
  mkdir -p "${out_link%/*}"
  ln -s /nix/store/fake "$out_link"
  ;;
*)
  exit 64
  ;;
esac
FAKE_NIX
chmod +x "$fake_bin/nix"

load_call() {
  mapfile -d '' -t call_args <"$1"
}

reset_log() {
  rm -rf "$log_dir"
  mkdir -p "$log_dir"
}

prepare_case() {
  local case_name=$1

  workspace="$tmpdir/$case_name"
  log_dir="$workspace/nix-log"
  runner="$workspace/check-full"
  mkdir -p "$workspace/.direnv/check-full/generations/previous" "$log_dir"
  touch "$workspace/flake.nix"
  printf 'previous generation\n' >"$workspace/.direnv/check-full/generations/previous/marker"
  ln -s generations/previous "$workspace/.direnv/check-full/current"
  printf '%s\n' "${runner_contents//@system@/$case_name}" >"$runner"
  chmod +x "$runner"
}

run_runner() {
  local inventory=$1
  local build_result=$2

  (
    cd "$workspace"
    PATH="$fake_bin:$PATH" \
      NIX_LOG_DIR="$log_dir" \
      NIX_SYSTEM="$system" \
      NIX_INVENTORY="$inventory" \
      NIX_BUILD_RESULT="$build_result" \
      bash "$runner"
  )
}

call_files_by_command() {
  local command=$1
  local call_file

  matching_call_files=()
  for call_file in "$log_dir"/[0-9]*; do
    load_call "$call_file"
    [[ ${call_args[0]} == "$command" ]] && matching_call_files+=("$call_file")
  done

  return 0
}

assert_call_commands() {
  local -a expected=("$@")
  local -a actual=()
  local call_file
  local index

  for call_file in "$log_dir"/[0-9]*; do
    load_call "$call_file"
    actual+=("${call_args[0]}")
  done
  [[ ${#actual[@]} -eq ${#expected[@]} ]] || fail "unexpected command count: ${#actual[@]}"
  for index in "${!expected[@]}"; do
    [[ ${actual[index]} == "${expected[index]}" ]] || fail "unexpected command order: ${actual[*]}"
  done

  call_files_by_command flake
  [[ ${#matching_call_files[@]} -eq 1 ]] || fail "expected one structural check"
  load_call "${matching_call_files[0]}"
  [[ ${call_args[*]} == 'flake check --no-build --no-update-lock-file' ]] || fail "unexpected structural check invocation"
}

assert_build_roots() {
  local -a expected=("$@")
  local -a roots=()
  local argument
  local index=1

  call_files_by_command build
  [[ ${#matching_call_files[@]} -eq 1 ]] || fail "expected one build invocation, got ${#matching_call_files[@]}"
  load_call "${matching_call_files[0]}"
  [[ ${call_args[index]} == --no-update-lock-file ]] || fail "build omitted --no-update-lock-file"
  ((index += 1))
  [[ ${call_args[index]} == -L ]] || fail "build omitted -L"
  ((index += 1))
  [[ ${call_args[index]} == --out-link ]] || fail "build omitted --out-link"
  ((index += 1))
  build_out_link=${call_args[index]}
  ((index += 1))
  roots=("${call_args[@]:index}")
  assert_values_exactly_once roots expected
  [[ $build_out_link == "$workspace/.direnv/check-full/generations/generation-"*/result ]] || fail "build used a non-final generation path"
  [[ -d ${build_out_link%/result} ]] || fail "successful build generation is absent"
}

assert_eval_targets() {
  local -a expected=("$@")
  local -a actual=()
  local call_file
  local last_index

  call_files_by_command eval
  for call_file in "${matching_call_files[@]}"; do
    load_call "$call_file"
    last_index=$((${#call_args[@]} - 1))
    actual+=("${call_args[last_index]}")
    assert_contains "${call_args[*]}" --no-update-lock-file
  done
  assert_values_exactly_once actual expected
}

check_segments=(
  '"alpha"'
  '"line\nname"'
  '"quote\"name"'
  '"space name"'
)

system=aarch64-darwin
prepare_case "$system"
darwin_output=$(run_runner normal success 2>&1)
assert_contains "$darwin_output" 'Discovered 4 flake checks for aarch64-darwin'
for check_segment in "${check_segments[@]}"; do
  assert_contains "$darwin_output" "$check_segment"
done
assert_call_commands flake eval build
assert_eval_targets '.#checks.aarch64-darwin'
assert_build_roots \
  '.#checks.aarch64-darwin."alpha"' \
  '.#checks.aarch64-darwin."line\nname"' \
  '.#checks.aarch64-darwin."quote\"name"' \
  '.#checks.aarch64-darwin."space name"' \
  '.#darwinConfigurations.seiran.system' \
  '.#darwinConfigurations.seiran-vm1.system' \
  '.#homeConfigurations."neo@seiran-clean".activationPackage'

current="$workspace/.direnv/check-full/current"
current_target=$(readlink "$current")
[[ $current_target == generations/generation-* ]] || fail "successful run did not select its final generation"
[[ ! -e "$workspace/.direnv/check-full/generations/previous" ]] || fail "former generation was retained"
[[ -L "$workspace/.direnv/check-full/$current_target/result" ]] || fail "current generation lacks build roots"

reset_log
if run_runner normal fail >/dev/null 2>&1; then
  fail "failing build unexpectedly succeeded"
fi
[[ "$(readlink "$current")" == "$current_target" ]] || fail "failed build changed current"
[[ -L "$workspace/.direnv/check-full/$current_target/result" ]] || fail "failed build removed current generation"
shopt -s nullglob
failed_generations=("$workspace/.direnv/check-full/generations"/generation-*)
[[ ${#failed_generations[@]} -eq 1 ]] || fail "failed build left a generation"

reset_log
if empty_output=$(run_runner empty success 2>&1); then
  fail "empty inventory unexpectedly succeeded"
fi
assert_contains "$empty_output" 'no flake checks'
call_files_by_command build
[[ ${#matching_call_files[@]} -eq 0 ]] || fail "empty inventory invoked build"

system=aarch64-linux
prepare_case "$system"
linux_output=$(run_runner normal success 2>&1)
assert_contains "$linux_output" 'Discovered 4 flake checks for aarch64-linux'
assert_call_commands flake eval build
assert_eval_targets '.#checks.aarch64-linux'
assert_build_roots \
  '.#checks.aarch64-linux."alpha"' \
  '.#checks.aarch64-linux."line\nname"' \
  '.#checks.aarch64-linux."quote\"name"' \
  '.#checks.aarch64-linux."space name"'

system=x86_64-linux
prepare_case "$system"
x86_output=$(run_runner normal success 2>&1)
assert_contains "$x86_output" 'Discovered 4 flake checks for x86_64-linux'
assert_call_commands flake eval eval build
assert_eval_targets \
  '.#checks.x86_64-linux' \
  '.#checks.aarch64-linux.nixos-seiran-vm0.drvPath'
assert_build_roots \
  '.#checks.x86_64-linux."alpha"' \
  '.#checks.x86_64-linux."line\nname"' \
  '.#checks.x86_64-linux."quote\"name"' \
  '.#checks.x86_64-linux."space name"'
