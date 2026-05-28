{
  delib,
  lib,
  ...
}:
delib.host {
  name = "seiran-vm0";

  homeManagerSystem = "aarch64-linux";
  home.home.stateVersion = "25.05";

  nixos = {
    boot.loader.grub.enable = false;
    boot.loader.systemd-boot = {
      enable = true;
      configurationLimit = 10;
    };
    boot.loader.efi = {
      canTouchEfiVariables = true;
      efiSysMountPoint = "/boot";
    };
    boot.initrd.availableKernelModules = ["virtio_pci" "xhci_pci" "usbhid"];
    boot.initrd.kernelModules = [];
    boot.kernelModules = [];
    boot.extraModulePackages = [];

    fileSystems."/" = {
      device = "/dev/disk/by-uuid/bb6630aa-92af-4f13-b59d-8500416fe982";
      fsType = "ext4";
    };

    fileSystems."/boot" = {
      device = "/dev/disk/by-uuid/8C02-4CEA";
      fsType = "vfat";
      options = ["fmask=0077" "dmask=0077"];
    };

    swapDevices = [];

    system.stateVersion = "25.11";
    nixpkgs.hostPlatform = lib.mkDefault "aarch64-linux";
  };
}
