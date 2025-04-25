{
  plugins = {
    lsp.servers.efm = {
      filetypes = ["zig"];
      settings = {
        languages = {
          zig = [
            {
              prefix = "zlint";
              lintSource = "zlint";
              lintCommand = "echo ${"'\${INPUT}'"} | zlint --no-summary -f gh -S";
              lintStdin = false;
              lintFormats = ["::%t file=%f,line=%l,col=%c,title=%*[^:]:%m"];
              lintIgnoreExitCode = true;
              rootMarkers = [
                "build.zig.zon"
              ];
            }
          ];
        };
      };
    };
  };
}
