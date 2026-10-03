{pkgs, ...}: let
  lib = pkgs.lib;
  mylib = import ../../lib {inherit lib;};

  # Fragment definitions go through the option so its merge rules apply.
  evaluate = modules:
    (lib.evalModules {
      modules = [{options.fragments = mylib.fragments.option;}] ++ modules;
    }).config.fragments;

  render = modules: mylib.fragments.render (evaluate modules);
  fails = modules: !(builtins.tryEval (render modules)).success;

  ordered = render [
    {
      fragments = {
        last.text = "last";
        last.after = ["anchor"];
        first.text = "first";
        first.before = ["anchor"];
        anchor.text = "anchor";
        free-b.text = "free-b";
        free-a.text = "free-a";
      };
    }
  ];
in
  assert lib.assertMsg (ordered == "first\nanchor\nfree-a\nfree-b\nlast")
  "Fragments must follow declared edges and break ties by name, got:\n${ordered}";
  assert lib.assertMsg (fails [
    {
      fragments.a = {
        text = "a";
        after = ["missing"];
      };
    }
  ])
  "A reference to an undefined fragment must fail";
  assert lib.assertMsg (fails [
    {
      fragments = {
        a = {
          text = "a";
          after = ["b"];
        };
        b = {
          text = "b";
          after = ["a"];
        };
      };
    }
  ])
  "A dependency cycle must fail";
  assert lib.assertMsg (fails [{fragments.a.text = "one";} {fragments.a.text = "two";}])
  "Conflicting texts for one fragment must fail instead of concatenating";
    pkgs.runCommand "fragments-test" {} ''
      mkdir "$out"
    ''
