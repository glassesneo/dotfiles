{
  buildNpmPackage,
  fetchFromGitHub,
  lib,
}:
buildNpmPackage rec {
  pname = "brave-search-mcp-server";
  version = "2.0.85";

  src = fetchFromGitHub {
    owner = "brave";
    repo = "brave-search-mcp-server";
    rev = "v${version}";
    hash = "sha256-u9NE9Pqzzt7AIzeOxduDNUVzi2chRa1dRydmnbFB4FU=";
  };

  postPatch = ''
    cp ${./package-lock.json} package-lock.json
  '';

  npmDepsHash = "sha256-uZQhSZd86gTpGtLsBA/9wbm7EIbbXYi2kPmrNtOmWjs=";
  npmDepsFetcherVersion = 2;

  meta = {
    description = "MCP server for the Brave Search API";
    homepage = "https://github.com/brave/brave-search-mcp-server";
    license = lib.licenses.mit;
    mainProgram = "brave-search-mcp-server";
  };
}
