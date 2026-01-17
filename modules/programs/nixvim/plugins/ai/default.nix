{
  delib,
  host,
  inputs,
  lib,
  llm-agents,
  nodePkgs,
  pkgs,
  ...
}: let
  mcp-hub = inputs.mcp-hub.packages."${host.homeManagerSystem}".default;
  mcphub-nvim = inputs.mcphub-nvim.packages."${host.homeManagerSystem}".default;
in
  delib.module {
    name = "programs.nixvim.plugins.ai";

    options = delib.singleEnableOption true;

    home.ifEnabled.programs.nixvim = {
      plugins = {
        copilot-lua = {
          enable = true;
          settings = {
            panel.enabled = false;
            suggestion.enabled = false;
          };
          lazyLoad = {
            enable = true;
            settings = {
              cmd = ["InsertEnter"];
            };
          };
        };
        codecompanion = {
          enable = true;
          lazyLoad = {
            enable = true;
            settings = {
              cmd = [
                "CodeCompanion"
                "CodeCompanionChat"
              ];
              keys = [
                {
                  __unkeyed-1 = "<Space>c";
                  mode = ["n"];
                  __unkeyed-3 = "<Cmd>CodeCompanionChat Toggle<CR>";
                }
                {
                  __unkeyed-1 = "CC";
                  mode = ["ca"];
                  __unkeyed-3 = "CodeCompanion";
                }
                {
                  __unkeyed-1 = "CCA";
                  mode = ["ca"];
                  __unkeyed-3 = "CodeCompanionActions";
                }
              ];
              before.__raw = ''
                function()
                  ${builtins.readFile
                  <| pkgs.replaceVars ./codecompanion-preload.lua {
                    mcp-hub-exe = lib.getExe' mcp-hub "mcp-hub";
                  }}
                end
              '';
            };
          };
          settings = {
            adapters = {
              http = {
                copilot.__raw = ''
                  function()
                    ${builtins.readFile ./adapters/copilot.lua}
                  end
                '';
                gemini.__raw = ''
                  function()
                    ${builtins.readFile ./adapters/gemini.lua}
                  end
                '';
                ollama.__raw = ''
                  function()
                    ${builtins.readFile ./adapters/ollama.lua}
                  end
                '';
                cerebras.__raw = ''
                  function()
                    ${builtins.readFile ./adapters/cerebras.lua}
                  end
                '';
                io-intelligence.__raw = ''
                  function()
                    ${builtins.readFile ./adapters/io-intelligence.lua}
                  end
                '';
                ai-mop-openai.__raw = ''
                  function()
                    ${builtins.readFile ./adapters/ai-mop-openai.lua}
                  end
                '';
                ai-mop-anthropic.__raw = ''
                  function()
                    ${builtins.readFile ./adapters/ai-mop-anthropic.lua}
                  end
                '';
              };
              acp = {
                claude_code.__raw = ''
                  function()
                    ${builtins.readFile
                    <| pkgs.replaceVars ./adapters/claude-code.lua {
                      command = lib.getExe llm-agents.claude-code-acp;
                      # mcpServers = nixvimLib.nixvim.toLuaObject acpMcpServers;
                    }}
                  end
                '';
                gemini_cli.__raw = ''
                  function()
                    ${builtins.readFile ./adapters/gemini-cli.lua}
                  end
                '';
              };
            };
            extensions = {
              history = {
                enabled = true;
                opts = {
                  auto_generate_title = true;
                  title_generation_opts = {
                    adapter = "copilot";
                    model = "gpt-5-mini";
                  };
                };
              };
              mcphub = {
                callback = "mcphub.extensions.codecompanion";
                opts = {
                  show_result_in_chat = true;
                  make_vars = true;
                  make_slash_commands = true;
                  requires_approval = true;
                };
              };
            };
            opts = {
              log_level = "TRACE";
            };
            prompt_library = {
              "Agentic workflow" = {
                strategy = "workflow";
                description = "Autonomous agent with file editing, command execution, and Neovim MCP capabilities";
                opts = {
                  index = 1;
                  is_default = true;
                  short_name = "agent";
                  adapter = {
                    name = "copilot";
                    model = "claude-sonnet-4.5";
                  };
                };
                prompts = [
                  [
                    {
                      role = "system";
                      content.__raw = ''
                        function(context)
                          vim.g.codecompanion_yolo_mode = true;
                          vim.g.codecompanion_tdd_mode = false
                          vim.g.codecompanion_tests_written = false
                          vim.g.codecompanion_implementation_done = false

                          return string.format([[
                            You are an autonomous coding agent with TDD (Test-Driven Development) capabilities.

                            TOOLS AVAILABLE:
                            1. @{insert_edit_into_file} - Edit files with structured patch format
                            2. @{cmd_runner} - Execute shell commands
                            3. @{neovim} - Explore codebase via MCP

                            TDD WORKFLOW (STRICTLY FOLLOW):
                            Phase 1 - WRITE TESTS FIRST:
                              - Create or update test files using @{insert_edit_into_file}
                              - Write failing tests that define the expected behavior
                              - Run tests with @{cmd_runner} to verify they fail
                              - Say "TESTS WRITTEN AND FAILING" when done

                            Phase 2 - IMPLEMENT FEATURE:
                              - Implement the minimal code to make tests pass
                              - Use @{insert_edit_into_file} for implementation
                              - Run tests with @{cmd_runner} to verify they pass
                              - Say "IMPLEMENTATION COMPLETE" when tests pass

                            Phase 3 - REFACTOR:
                              - Improve code quality without changing behavior
                              - Keep running tests to ensure they still pass
                              - Say "REFACTORING COMPLETE" when done

                            CONTEXT:
                            - File: %s
                            - Filetype: %s
                            - Working directory: %s

                            CRITICAL: Always start with writing tests before implementation!
                          ]], context.filename or "unknown", context.filetype or "unknown", vim.fn.getcwd())
                        end
                      '';
                    }
                    {
                      role = "user";
                      content.__raw = ''
                        function(context)
                          return [[
                            I need you to help me implement a feature using TDD.

                            REMEMBER: Write tests FIRST, then implement!

                            Steps:
                            1. Analyze the requirement
                            2. Write tests that define expected behavior
                            3. Verify tests fail (Red)
                            4. Implement minimal code to pass tests (Green)
                            5. Refactor while keeping tests passing (Refactor)
                            Task:
                          ]]
                        end
                      '';
                      opts = {
                        auto_submit = false;
                        condition.__raw = ''
                          function()
                            -- Only run if implementation is complete
                            return vim.g.codecompanion_implementation_done == true
                          end
                        '';
                      };
                    }
                  ]
                  # Phase 2: Verify tests are written and failing (Red phase)
                  [
                    {
                      role = "user";
                      content.__raw = ''
                        function()
                          return [[
                            CHECK: Did you write tests first?

                            If NO tests written yet:
                            - Write tests NOW using @{insert_edit_into_file}
                            - Run them with @{cmd_runner} to verify they FAIL
                            - Respond with "TESTS WRITTEN AND FAILING"

                            If tests ARE written and failing:
                            - Respond with "TESTS WRITTEN AND FAILING"
                            - Proceed to implementation

                            If tests are passing already:
                            - Something is wrong with TDD approach
                            - Explain what happened

                            Status check NOW.]]
                        end
                      '';
                      opts = {
                        auto_submit = true;
                        condition.__raw = ''
                          function()
                            -- Run if any tool was used (meaning work was started)
                            return _G.codecompanion_current_tool ~= nil
                          end
                        '';
                        repeat_until.__raw = builtins.readFile ./callbacks/tests_written_check.lua;
                      };
                    }
                  ]
                  # Phase 3: Implement to make tests pass (Green phase)
                  [
                    {
                      role = "user";
                      content.__raw = ''
                        function()
                          return [[
                            IMPLEMENTATION PHASE (Green):

                            Now that tests are written and failing, implement the minimal code to make them pass.

                            Requirements:
                            1. Use @{insert_edit_into_file} to implement the feature
                            2. Run tests with @{cmd_runner} after implementation
                            3. If tests FAIL: Debug and fix until they pass
                            4. If tests PASS: Respond with "IMPLEMENTATION COMPLETE"

                            Start implementation NOW.]]
                        end
                      '';
                      opts = {
                        auto_submit = true;
                        condition.__raw = ''
                          function()
                            -- Only run if tests were written
                            return vim.g.codecompanion_tests_written == true
                          end
                        '';
                        repeat_until.__raw = builtins.readFile ./callbacks/implementation_done_check.lua;
                      };
                    }
                  ]
                  # Phase 4: Refactor while keeping tests passing (Refactor phase)
                  [
                    {
                      role = "user";
                      content.__raw = ''
                        function()
                          -- Clean up TDD flags
                          local tests_written = vim.g.codecompanion_tests_written or false
                          local impl_done = vim.g.codecompanion_implementation_done or false

                          vim.g.codecompanion_tests_written = nil
                          vim.g.codecompanion_implementation_done = nil
                          vim.g.codecompanion_tdd_mode = nil

                          return string.format([[
                            REFACTOR PHASE (Optional):

                            TDD Status:
                            - Tests Written: %s
                            - Implementation: %s

                            Now improve code quality:
                            1. Review the implementation for improvements
                            2. Refactor using @{insert_edit_into_file} if needed
                            3. Run tests with @{cmd_runner} after each change
                            4. Ensure tests still pass

                            Provide final summary:
                            - What tests were written
                            - What was implemented
                            - What was refactored
                            - Final test status

                            Keep summary concise.]],
                            tests_written and "✓" or "✗",
                            impl_done and "✓" or "✗")
                        end
                      '';
                      opts = {
                        auto_submit = false;
                      };
                    }
                  ]
                ];
              };
              "Refactor<->Test workflow" = {
                strategy = "workflow";
                description = "Iterative refactor-test cycle for code improvement and validation";
                opts = {
                  index = 2;
                  is_default = true;
                  short_name = "ref<->test";
                  adapter = {
                    name = "copilot";
                    model = "gpt-5-codex";
                  };
                };
                prompts = [
                  # Phase 1: Initial refactoring
                  [
                    {
                      role = "system";
                      content.__raw = ''
                        function(context)
                          vim.g.codecompanion_yolo_mode = true;
                          return [[
                            You are a meticulous code refactoring assistant. Your ONLY job in this phase is to refactor code.

                            CRITICAL INSTRUCTIONS:
                            1. You MUST use the @{insert_edit_into_file} or @{neovim__edit_file} tool to make actual changes
                            2. DO NOT just describe changes - MAKE them using the tool
                            3. DO NOT ask for permission - proceed with refactoring immediately
                            4. DO NOT end your response until you have used the tool
                            5. Complete ALL refactoring before stopping

                            Refactoring priorities:
                            1. Improve code clarity and readability
                            2. Extract repeated code into functions
                            3. Improve naming conventions
                            4. Add missing documentation
                            5. Optimize performance where applicable
                          ]]
                        end
                      '';
                    }
                    {
                      role = "user";
                      content.__raw = ''
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
                          else return [[
                            You MUST:
                            1. Use @{insert_edit_into_file} @{neovim__edit_file} to make changes
                            2. Complete ALL improvements before responding
                            3. Refer to #{lsp}

                            START REFACTORING NOW using the tool.
                            Here is the detailed specification:
                          ]] end
                        end
                      '';
                      opts = {
                        auto_submit = false;
                        condition.__raw = ''
                          function()
                            -- Only run if cmd_runner was used (meaning tests were actually run)
                            return _G.codecompanion_current_tool == "cmd_runner"
                          end
                        '';
                        repeat_until.__raw = builtins.readFile ./callbacks/tests_passed_check.lua;
                      };
                    }
                  ]
                  # Phase 2: Run tests
                  [
                    {
                      role = "system";
                      content.__raw = ''
                        function()
                          -- Initialize test tracking flag
                          vim.g.codecompanion_tests_passed = false
                          vim.g.codecompanion_test_iterations = 0

                          return [[
                            Now your job is to run tests. You MUST:
                            1. Use @{cmd_runner} to execute the test suite
                            2. DO NOT skip this step
                            3. Wait for test results before proceeding

                            Common test commands by language:
                            - Python: pytest, python -m pytest, python -m unittest
                            - JavaScript/TypeScript: npm test, yarn test, pnpm test
                            - Rust: cargo test
                            - Go: go test ./...
                            - Ruby: rspec, rake test
                            - Java: mvn test, gradle test
                            - Nix: nix flake check, nix build

                            Execute the appropriate test command NOW.
                          ]]
                        end
                      '';
                    }
                    {
                      role = "user";
                      content = "Run the test suite using @{cmd_runner}. Execute the appropriate test command for this project NOW. Do not proceed until tests are run.";
                      opts = {
                        auto_submit = true;
                        condition.__raw = ''
                          function()
                            -- Only run if cmd_runner tool was actually used in refactoring
                            return _G.codecompanion_current_tool == "cmd_runner" or _G.codecompanion_current_tool == nil
                          end
                        '';
                      };
                    }
                  ]
                  # Phase 3: Fix test failures (repeats until tests pass)
                  [
                    {
                      role = "system";
                      content.__raw = ''
                        function()
                          local iteration = vim.g.codecompanion_test_iterations or 0
                          vim.g.codecompanion_test_iterations = iteration + 1

                          return string.format([[
                            Now analyze test results and fix any failures (Iteration %d).

                            CRITICAL INSTRUCTIONS:
                            1. Check the most recent @{cmd_runner} output for test results
                            2. If tests PASSED: Set the completion flag and stop
                            3. If tests FAILED: You MUST:
                               a. Use @{insert_edit_into_file} to fix the issues
                               b. Use @{cmd_runner} to run tests again
                               c. DO NOT just explain - FIX IT

                            After fixing and re-running tests:
                            - If tests now pass: Say "TESTS PASSED" in your response
                            - If tests still fail: Explain what you fixed and try again

                            DO NOT end without either fixing issues or confirming tests pass.
                          ]], iteration)
                        end
                      '';
                    }
                    {
                      role = "user";
                      content.__raw = ''
                        function()
                          local iteration = vim.g.codecompanion_test_iterations or 1
                          return string.format([[
                            [Fix-Test Cycle %d]

                            1. Check test results from @{cmd_runner}
                            2. If FAILED: Fix with @{insert_edit_into_file} then re-run with @{cmd_runner}
                            3. If PASSED: Respond with "TESTS PASSED" to end the cycle

                            Start NOW.
                          ]], iteration)
                        end
                      '';
                      opts = {
                        auto_submit = true;
                      };
                    }
                  ]
                  # Phase 4: Verification and summary
                  [
                    {
                      role = "user";
                      content.__raw = ''
                        function()
                          local iterations = vim.g.codecompanion_test_iterations or 0
                          local tests_passed = vim.g.codecompanion_tests_passed or false

                          -- Clean up global flags
                          vim.g.codecompanion_test_iterations = nil
                          vim.g.codecompanion_tests_passed = nil

                          return string.format([[
                            FINAL SUMMARY REQUIRED

                            Completed after %d fix-test iteration(s).
                            Test Status: %s

                            Please provide:
                            1. What refactoring was performed?
                            2. Final test status
                            3. Any remaining issues or recommendations

                            Keep this summary concise.
                          ]], iterations, tests_passed and "PASSED ✓" or "FAILED or UNKNOWN")
                        end
                      '';
                      opts = {
                        auto_submit = true;
                      };
                    }
                  ]
                ];
              };
              # Plan mode: generates TODO.md with task list using gpt-5-codex
              "Plan Mode" = {
                strategy = "workflow";
                description = "Generate TODO.md with task breakdown for implementing a feature";
                opts = {
                  index = 3;
                  is_default = true;
                  short_name = "plan";
                  adapter = {
                    name = "copilot";
                    model = "gpt-5-mini";
                  };
                };
                prompts = [
                  # Phase 1: Autonomous codebase exploration
                  [
                    {
                      role = "system";
                      content.__raw = ''
                        function(context)
                          -- Initialize workflow state
                          vim.g.codecompanion_exploration_done = false
                          vim.g.codecompanion_info_gathered = false
                          vim.g.codecompanion_proposal_approved = false

                          return string.format([[
                            You are an expert software architect and project planner.

                            YOUR ROLE: You are NOT implementing the feature. You are ONLY identifying and planning tasks.

                            PHASE 1: CODEBASE EXPLORATION

                            Your objective: Explore the codebase to understand how to implement the requested feature, then ask clarifying questions.

                            AVAILABLE TOOLS:
                            - @{neovim__find_files} - Find files by pattern
                            - @{neovim__read_file} - Read specific file
                            - @{neovim__read_multiple_files} - Read multiple files
                            - @{neovim__list_directory} - List directory contents
                            - @{read_file} - Alternative file reading

                            EXPLORATION CHECKLIST:
                            1. Find relevant files and directories for the feature
                            2. Read existing code to understand patterns and architecture
                            3. Look for similar features to understand implementation style
                            4. Identify integration points and dependencies
                            5. Note testing patterns and conventions

                            CONTEXT:
                            - Working directory: %s
                            - Current file: %s
                            - Filetype: %s

                            OUTPUT FORMAT:
                            After exploration, provide:

                            **Found:**
                            [2-3 sentence summary of discoveries - keep it concise]

                            **Questions:**
                            1. [Specific clarifying question]
                            2. [Specific clarifying question]
                            ...

                            CONSTRAINTS:
                            - Summary must be 2-3 sentences maximum
                            - Ask ALL clarifying questions in a numbered list
                            - DO NOT create TODO.md yet
                            - STOP and wait for user answers after questions
                          ]], vim.fn.getcwd(), context.filename or "unknown", context.filetype or "unknown")
                        end
                      '';
                    }
                    {
                      role = "user";
                      content.__raw = ''
                        function(context)
                          return [[
                            Help me plan the implementation of this feature.

                            Steps:
                            1. Explore the codebase using @{neovim} tools
                            2. Provide a brief 2-3 sentence summary
                            3. Ask ALL clarifying questions

                            Keep explanations concise. Do not create TODO.md yet.

                            Feature request:
                          ]]
                        end
                      '';
                      opts = {
                        auto_submit = false;
                      };
                    }
                  ]
                  # Phase 2: User provides answers to clarifying questions
                  [
                    {
                      role = "user";
                      content = "Here are my answers to your questions:\n";
                      opts = {
                        auto_submit = false;
                      };
                    }
                  ]
                  # Phase 3: Request TODO.md structure proposal
                  [
                    {
                      role = "user";
                      content = ''
                        Based on our discussion, create a SUMMARY of the planned TODO.md structure.

                        Include:
                        - Task categories with task counts
                        - Total number of tasks
                        - Key files that will be modified

                        DO NOT create the TODO.md file yet.

                        After showing the summary, ask: "Do you approve this structure? Reply 'yes' to generate TODO.md."
                      '';
                      opts = {
                        auto_submit = false;
                      };
                    }
                  ]
                  # Phase 4: Generate TODO.md (only if approved)
                  [
                    {
                      role = "user";
                      content.__raw = ''
                        function()
                          -- Clean up workflow state
                          vim.g.codecompanion_exploration_done = nil
                          vim.g.codecompanion_info_gathered = nil
                          vim.g.codecompanion_proposal_approved = nil

                          return string.format([[
                            Generate the complete TODO.md file using @{create_file}.

                            REQUIRED STRUCTURE:

                            # Feature: [Feature Name]

                            ## Overview
                            [Brief description of the feature and its purpose - 2-3 sentences]

                            ## Task Breakdown

                            ### 1. [Category Name] (e.g., Setup, Core Implementation, Testing)
                            - [ ] Task 1.1: [Clear, actionable task description]
                              - Files: [Specific file paths]
                              - Notes: [Implementation details if needed]
                            - [ ] Task 1.2: [Clear, actionable task description]

                            ### 2. [Category Name]
                            - [ ] Task 2.1: [Clear, actionable task description]

                            ## Testing Strategy
                            - [ ] Unit tests: [Specific test cases]
                            - [ ] Integration tests: [Specific workflows to test]

                            ## Dependencies
                            - [List external dependencies or prerequisites]

                            ## Implementation Order
                            1. [First task/category]
                            2. [Second task/category]
                            3. [Final task/category]

                            REQUIREMENTS:
                            1. Tasks must be small and atomic (completable in one session)
                            2. Organize by category: Setup, Core, Testing, Documentation
                            3. Include specific file paths and function names
                            4. Add implementation notes only for complex tasks
                            5. Provide clear implementation order
                            6. Include comprehensive testing tasks

                            File location: %s/TODO.md

                            After creation, respond: "TODO.md created successfully at %s/TODO.md"
                          ]], vim.fn.getcwd(), vim.fn.getcwd())
                        end
                      '';
                      opts = {
                        auto_submit = false;
                      };
                    }
                  ]
                ];
              };
              # Implementation mode: uses TODO.md to implement feature with claude-sonnet-4.5
              "Implementation Mode" = {
                strategy = "workflow";
                description = "Implement feature by following TODO.md task list";
                opts = {
                  index = 4;
                  is_default = true;
                  short_name = "impl";
                  adapter = {
                    name = "copilot";
                    model = "claude-sonnet-4.5";
                  };
                };
                prompts = [
                  # Phase 1: Load and analyze TODO.md
                  [
                    {
                      role = "system";
                      content.__raw = ''
                        function(context)
                          vim.g.codecompanion_yolo_mode = true;
                          vim.g.codecompanion_current_task = nil;
                          vim.g.codecompanion_tasks_completed = 0;

                          return string.format([[
                            You are a meticulous software engineer implementing features step-by-step from a TODO.md file.

                            AVAILABLE TOOLS:
                            - @{insert_edit_into_file} - Edit files with structured patches
                            - @{cmd_runner} - Execute shell commands
                            - @{read_file} - Read file contents
                            - @{neovim} - Explore codebase via MCP

                            CONTEXT SOURCES:
                            - #{lsp} - LSP diagnostics and errors in current file
                            - #{buffer} - Current buffer contents
                            - @{read_file} - Read TODO.md and other files

                            IMPLEMENTATION WORKFLOW:
                            1. Read TODO.md using @{read_file}
                            2. Check #{lsp} for existing errors before starting
                            3. Implement tasks following the specified order
                            4. Update TODO.md after each task (change - [ ] to - [x])
                            5. Check #{lsp} after each change for new errors
                            6. Run tests after significant changes
                            7. Verify implementation before moving to next task

                            CURRENT CONTEXT:
                            - File: %s
                            - Filetype: %s
                            - Working directory: %s

                            REQUIREMENTS:
                            - Follow implementation order from TODO.md strictly
                            - Use #{lsp} to catch type errors and diagnostics early
                            - Update TODO.md to track progress
                            - Run tests to verify each task
                            - Fix all LSP errors before marking task complete
                            - Document any deviations from the plan in TODO.md
                          ]], context.filename or "unknown", context.filetype or "unknown", vim.fn.getcwd())
                        end
                      '';
                    }
                    {
                      role = "user";
                      content.__raw = ''
                        function(context)
                          return [[
                            Let's implement the feature by following TODO.md step-by-step.

                            Workflow:
                            1. Read TODO.md using @{read_file}
                            2. Check #{lsp} for existing diagnostics
                            3. Start with first uncompleted task
                            4. Implement the task using appropriate tools
                            5. Check #{lsp} after implementation
                            6. Update TODO.md (change - [ ] to - [x])
                            7. Run relevant tests to verify

                            Begin implementation now.
                          ]]
                        end
                      '';
                      opts = {
                        auto_submit = true;
                      };
                    }
                  ]
                  # Phase 2: Iterative task implementation
                  [
                    {
                      role = "user";
                      content.__raw = ''
                        function()
                          local iteration = vim.g.codecompanion_tasks_completed or 0
                          vim.g.codecompanion_tasks_completed = iteration + 1

                          return string.format([[
                            Implementation Cycle %d:

                            Steps:
                            1. Check TODO.md for next uncompleted task
                            2. Implement using @{insert_edit_into_file}
                            3. Run tests with @{cmd_runner} if applicable
                            4. Update TODO.md (mark as - [x])
                            5. Respond: "TASK COMPLETE: [task name]"

                            When all tasks complete:
                            - Respond: "ALL TASKS COMPLETE"
                            - Delete TODO.md using @{cmd_runner}

                            Continue with next task.
                          ]], iteration)
                        end
                      '';
                      opts = {
                        auto_submit = true;
                        repeat_until.__raw = builtins.readFile ./callbacks/all_tasks_complete_check.lua;
                      };
                    }
                  ]
                  # Phase 3: Final verification and summary
                  [
                    {
                      role = "user";
                      content.__raw = ''
                        function()
                          local tasks_completed = vim.g.codecompanion_tasks_completed or 0

                          vim.g.codecompanion_tasks_completed = nil
                          vim.g.codecompanion_current_task = nil

                          return string.format([[
                            FINAL VERIFICATION:

                            Completed %d implementation cycles.

                            Please provide:
                            1. Summary of what was implemented
                            2. Which tasks from TODO.md were completed
                            3. Any tasks that were skipped or modified
                            4. Test results summary
                            5. Recommended next steps

                            Also run final tests with @{cmd_runner} to ensure everything works.

                            Keep summary concise (under 10 lines).
                          ]], tasks_completed)
                        end
                      '';
                      opts = {
                        auto_submit = true;
                      };
                    }
                  ]
                ];
              };
            };
            strategies = {
              chat = {
                adapter = "copilot";
                roles = {
                  llm.__raw = ''
                    function(adapter)
                      local model_name = ""
                      if adapter.type == "http" then
                        if adapter.parameters == nil then
                          model_name = adapter.schema.model.default
                        else
                          model_name = adapter.schema.model.default
                        end
                        return "  CodeCompanion (" .. adapter.formatted_name .. " - " .. model_name .. ")"
                      elseif adapter.type == "acp" then
                        return "  " .. adapter.formatted_name .. " via ACP"
                      end
                      return "  CodeCompanion"
                    end
                  '';
                  user = "  Me";
                };
                tools = {
                  opts = {
                    auto_submit_errors = true;
                    auto_submit_success = true;
                  };
                };
              };
            };
            display = {
              chat = {
                window = {
                  position = "right";
                  width = 0.425;
                };
                auto_scroll = true;
                show_header_separator = true;
                fold_context = true;
                fold_reasoning = true;
              };
            };
          };
        };
      };
      extraPlugins = [
        {
          plugin = pkgs.vimPlugins.codecompanion-history-nvim;
          optional = true;
        }
        mcphub-nvim
      ];

      extraConfigLua = ''
        require('lz.n').load({{
          'codecompanion-history.nvim',
        }})
      '';
    };
  }
