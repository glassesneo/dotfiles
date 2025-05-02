{
  diagnostic.settings = {
    severity_sort = true;
    float = {
      border = "single";
      title = "Diagnostics";
      header = {};
      suffix = {};
      format.__raw = ''
        function(diag)
          if diag.code then
            return string.format("[%s](%s): %s", diag.source, diag.code, diag.message)
          else
            return string.format("[%s]: %s", diag.source, diag.message)
          end
        end
      '';
    };
  };
}
