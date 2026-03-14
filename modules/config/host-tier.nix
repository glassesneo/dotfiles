{delib, ...}:
delib.module {
  name = "config.host-tier";

  myconfig.always.args.shared.tiers = let
    ordered = ["minimal" "basic" "standard" "full"];
    ranks = builtins.listToAttrs (
      builtins.genList (i: {
        name = builtins.elemAt ordered i;
        value = i;
      }) (builtins.length ordered)
    );
    rankOf = tier: ranks.${tier};
  in {
    inherit ordered;
    rank = rankOf;
    atLeast = current: minimum: rankOf current >= rankOf minimum;
    atMost = current: maximum: rankOf current <= rankOf maximum;
  };
}
