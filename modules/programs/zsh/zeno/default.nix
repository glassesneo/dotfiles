{
  delib,
  inputs,
  homeConfig,
  pkgs,
  ...
}:
delib.module {
  name = "programs.zsh.zeno";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled = let
    zenoPatched = pkgs.runCommandLocal "zeno.zsh-patched" {} ''
      cp -R ${inputs.zeno-zsh} $out
      chmod -R u+w $out

      for f in \
        "$out/zeno.zsh" \
        "$out/bin/zeno" \
        "$out/bin/zeno-server"
      do
        sed -i 's/--node-modules-dir=auto/--node-modules-dir=none/g' "$f"
      done
    '';
  in {
    programs.zsh = {
      plugins = [
        {
          name = "zeno";
          src = zenoPatched;
          file = "zeno-plugin.zsh";
        }
      ];
      sessionVariables = {
        ZENO_ENABLE_FZF_TMUX = "1";
        ZENO_FZF_TMUX_OPTIONS = "-p 80%,50%";
        ZENO_DISABLE_EXECUTE_CACHE_COMMAND = "1";
        DENO_DIR = "${homeConfig.xdg.cacheHome}/deno";
        DENO_NO_UPDATE_CHECK = "1";
        DENO_NO_PROMPT = "1";
      };
      initContent = ''
        if [[ -n $ZENO_LOADED ]]; then
          bindkey ' '   zeno-auto-snippet
          bindkey '^m'  zeno-auto-snippet-and-accept-line
          bindkey '^i'  zeno-completion
          bindkey '^xx' zeno-insert-snippet
          bindkey '^x ' zeno-insert-space
          bindkey '^x^m' accept-line
          bindkey '^x^z' zeno-toggle-auto-snippet
          bindkey '^xp' zeno-preprompt
          bindkey '^xs' zeno-preprompt-snippet
          bindkey '^r'  zeno-history-selection
          # bindkey '^r' zeno-smart-history-selection
        fi
      '';
    };
    xdg.configFile."zeno/config.ts".source = ./config.ts;
    home = {
      packages = with pkgs; [
        deno
        fzf
      ];
    };
  };
}
