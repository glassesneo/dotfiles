{
  delib,
  inputs,
  ...
}:
delib.module ({myconfig, ...}: {
  name = "agents";
  meta.description = "Provide a shared configuration interface for LLM agents and configure the selected agent packages.";

  options = {
    packages = delib.readOnly (delib.lazyAttrsOfOption delib.types.package inputs.llm-agents.packages.${myconfig.host.system});
  };
})
