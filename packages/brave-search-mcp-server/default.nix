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
    cp ${./smoke.test.mjs} repository-smoke.test.mjs
  '';

  npmDepsHash = "sha256-uZQhSZd86gTpGtLsBA/9wbm7EIbbXYi2kPmrNtOmWjs=";
  npmDepsFetcherVersion = 2;

  doCheck = true;
  checkPhase = ''
    runHook preCheck
    npm run format:check
    node --test repository-smoke.test.mjs
    runHook postCheck
  '';

  meta = {
    description = "MCP server for the Brave Search API";
    homepage = "https://github.com/brave/brave-search-mcp-server";
    license = lib.licenses.mit;
    mainProgram = "brave-search-mcp-server";
  };
}
