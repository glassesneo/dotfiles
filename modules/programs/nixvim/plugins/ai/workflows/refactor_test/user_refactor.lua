function(context)
  if context.is_visual then
    return string.format([[
Refactor this selected code. You MUST:
1. Use @{insert_edit_into_file} or @{neovim__edit_file} to make the changes
2. Complete ALL improvements before responding

Selected code:
```%s
%s
```

START REFACTORING NOW using the tool.
]], context.filetype, context.selection)
  else
    return [[
You MUST:
1. Use @{insert_edit_into_file} @{neovim__edit_file} to make changes
2. Complete ALL improvements before responding
3. Refer to #{lsp}

START REFACTORING NOW using the tool.
Here is the detailed specification:
]]
  end
end
