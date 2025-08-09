{pkgsMaster, ...}: {
  services.ollama = {
    enable = true;
    # package = pkgsMaster.ollama;
  };
}
