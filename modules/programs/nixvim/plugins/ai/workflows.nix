{
  delib,
  lib,
  myconfig,
  pkgs,
  ...
}:
delib.module {
  name = "programs.nixvim.plugins.ai.workflows";

  options = delib.singleCascadeEnableOption;

  home.ifEnabled.programs.nixvim = {
    plugins.codecompanion.settings.prompt_library = {
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
              content.__raw = builtins.readFile ./workflows/tdd/system.lua;
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
                    return _G.CCWorkflowState.get("implementation_done") == true
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
                    return _G.CCWorkflowState.get("tests_written") == true
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
              content.__raw = builtins.readFile ./workflows/tdd/refactor.lua;
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
          is_default = false;
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
              content.__raw = builtins.readFile ./workflows/refactor_test/system_refactor.lua;
            }
            {
              role = "user";
              content.__raw = builtins.readFile ./workflows/refactor_test/user_refactor.lua;
              opts = {
                auto_submit = false;
                condition.__raw = ''
                  function()
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
              content.__raw = builtins.readFile ./workflows/refactor_test/system_tests.lua;
            }
            {
              role = "user";
              content = "Run the test suite using @{cmd_runner}. Execute the appropriate test command for this project NOW. Do not proceed until tests are run.";
              opts = {
                auto_submit = true;
                condition.__raw = ''
                  function()
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
              content.__raw = builtins.readFile ./workflows/refactor_test/system_fix.lua;
            }
            {
              role = "user";
              content.__raw = builtins.readFile ./workflows/refactor_test/user_fix.lua;
              opts = {
                auto_submit = true;
              };
            }
          ]
          # Phase 4: Verification and summary
          [
            {
              role = "user";
              content.__raw = builtins.readFile ./workflows/refactor_test/summary.lua;
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
          is_default = false;
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
              content.__raw = builtins.readFile ./workflows/plan/system.lua;
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
              content.__raw = builtins.readFile ./workflows/plan/generate_todo.lua;
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
          is_default = false;
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
              content.__raw = builtins.readFile ./workflows/impl/system.lua;
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
              content.__raw = builtins.readFile ./workflows/impl/iteration.lua;
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
              content.__raw = builtins.readFile ./workflows/impl/summary.lua;
              opts = {
                auto_submit = true;
              };
            }
          ]
        ];
      };
    };
  };
}
