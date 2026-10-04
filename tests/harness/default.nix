# Build the published harness, so its type check and install check run with the
# other checks instead of only when the package is built explicitly.
{
  inputs,
  system,
}:
inputs.self.packages.${system}.harness
