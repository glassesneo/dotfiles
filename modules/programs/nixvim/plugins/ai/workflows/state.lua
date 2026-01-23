-- Module-local state management for CodeCompanion workflows
-- Centralizes all state handling to prevent leakage between workflow runs
-- This module is registered globally as _G.CCWorkflowState

local M = {}

-- Internal state storage (not polluting vim.g)
local state = {
  -- TDD workflow flags
  yolo_mode = false,
  tdd_mode = false,
  tests_written = false,
  implementation_done = false,

  -- Refactor<->Test workflow flags
  tests_passed = false,
  test_iterations = 0,

  -- Plan mode flags
  exploration_done = false,
  info_gathered = false,
  proposal_approved = false,

  -- Implementation mode flags
  current_task = nil,
  tasks_completed = 0,
}

-- Get state value
function M.get(key)
  return state[key]
end

-- Set state value
function M.set(key, value)
  state[key] = value
end

-- Increment numeric state value
function M.increment(key)
  if type(state[key]) == "number" then
    state[key] = state[key] + 1
  end
  return state[key]
end

-- Reset specific workflow state
function M.reset_tdd()
  state.yolo_mode = false
  state.tdd_mode = false
  state.tests_written = false
  state.implementation_done = false
end

function M.reset_refactor_test()
  state.yolo_mode = false
  state.tests_passed = false
  state.test_iterations = 0
end

function M.reset_plan()
  state.exploration_done = false
  state.info_gathered = false
  state.proposal_approved = false
end

function M.reset_implementation()
  state.yolo_mode = false
  state.current_task = nil
  state.tasks_completed = 0
end

-- Reset all state
function M.reset_all()
  M.reset_tdd()
  M.reset_refactor_test()
  M.reset_plan()
  M.reset_implementation()
end

-- Initialize TDD workflow
function M.init_tdd()
  M.reset_tdd()
  state.yolo_mode = true
  state.tdd_mode = false
  state.tests_written = false
  state.implementation_done = false
  M.sync_yolo_mode()
end

-- Initialize Refactor<->Test workflow
function M.init_refactor_test()
  M.reset_refactor_test()
  state.yolo_mode = true
  state.tests_passed = false
  state.test_iterations = 0
  M.sync_yolo_mode()
end

-- Initialize Plan mode
function M.init_plan()
  M.reset_plan()
  state.exploration_done = false
  state.info_gathered = false
  state.proposal_approved = false
end

-- Initialize Implementation mode
function M.init_implementation()
  M.reset_implementation()
  state.yolo_mode = true
  state.current_task = nil
  state.tasks_completed = 0
  M.sync_yolo_mode()
end

-- Backward compatibility: expose yolo_mode to vim.g for tools that check it
function M.sync_yolo_mode()
  vim.g.codecompanion_yolo_mode = state.yolo_mode
end

-- Register globally so workflows can access it
_G.CCWorkflowState = M
