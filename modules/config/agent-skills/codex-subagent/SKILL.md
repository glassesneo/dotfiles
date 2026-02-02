---
name: codex-subagent
description: "Interactive Codex sessions for complex, iterative work. Use for multi-step refactoring, exploratory debugging, building context over conversations, and tasks requiring back-and-forth collaboration. Launch in tmux for monitoring long-running work. For simple one-shot queries, use codex-exec skill instead. Triggers: codex interactive, codex subagent, tmux, iterative, complex refactoring, exploratory, multi-step"
---

# Codex Subagent: Interactive Sessions

## Quick Reference

```bash
codex                                   # Interactive TUI mode
codex -C /project                       # Interactive with working directory
```

**Key Profiles**: `-p planning` (read-only), `-p full-auto` (can make changes), `-p agent-browser` (Playwright)

## When to Use codex-subagent

Use **codex-subagent** for complex tasks requiring iteration:

- **Multi-step refactoring**: Changes that need careful planning and incremental work
- **Exploratory debugging**: Root cause analysis needing multiple rounds of investigation
- **Building context**: Tasks where Codex needs to learn about the codebase through conversation
- **Complex analysis**: Understanding large modules or unfamiliar architectures
- **Back-and-forth work**: Anything requiring clarification, follow-ups, or iterative refinement

**Don't use codex-subagent** for quick, one-off queries—use the **codex-exec** skill instead.

## Two Approaches to Interactive Mode

### 1. Direct TUI Mode (Simple)

Launch Codex in the terminal interactively:

```bash
codex -C /project -p planning
```

**Pros**: Simple, direct interaction
**Cons**: Blocks your terminal, harder to monitor alongside other work

### 2. Tmux Integration (Recommended)

Use the **tmux-runner** skill to launch Codex in a dedicated pane:

```bash
# Create new tmux pane for Codex
tmux split-window -h -p 40 "codex -C /project -p planning"

# Or use tmux-runner skill
"Run codex in a tmux pane: codex -C /project -p planning"
```

**Pros**:
- Monitor progress while working on other tasks
- Keep session running in background
- Send follow-up commands without restarting
- Review conversation history easily

**Cons**: Slightly more setup complexity

## Tmux Workflow Patterns

### Pattern 1: Create Pane + Monitor

```bash
# Create right pane (40% width) with Codex
tmux split-window -h -p 40 "codex -C /project"

# Watch progress in pane while you work elsewhere
# Send follow-ups by focusing the pane
```

### Pattern 2: Send Commands to Existing Session

```bash
# If Codex is already running in a pane:
tmux send-keys -t <pane-id> "your follow-up question here" C-m

# Or use tmux-runner skill to send text to a pane
"Send to Codex pane: explain the cache invalidation logic"
```

### Pattern 3: Capture Output from Pane

```bash
# Capture last N lines from Codex pane
tmux capture-pane -t <pane-id> -p -S -50

# Save full conversation
tmux capture-pane -t <pane-id> -p -S - > codex-session.txt
```

## Use Cases

### Complex Refactoring

**Interactive approach** allows incremental work with feedback loops:

```bash
# Launch Codex for refactoring session
codex -C /project -p planning

# Then in the session:
> "Analyze the auth module structure"
> "Propose a strategy to extract session management"
> "Show me how the current code handles token refresh"
> "Implement the extraction plan step by step"
```

### Exploratory Debugging

**Build context** through conversation:

```bash
# Start debugging session
codex -C /project -p planning

> "Where does the payment processing start?"
> "What happens when the API call fails?"
> "Show me all places that handle retry logic"
> "Why would we get a double-charge in this scenario?"
```

### Understanding Unfamiliar Codebases

**Iteratively map** a new codebase:

```bash
codex -C /new-project -p planning

> "Describe the overall architecture"
> "How does routing work in this app?"
> "Show me the data flow for user registration"
> "Where are environment variables configured?"
```

### Multi-Step Analysis

**Build up understanding** through sequential questions:

```bash
codex -C /project -p planning

> "What test coverage exists for the checkout flow?"
> "Are there tests for payment gateway timeouts?"
> "Show me edge cases in the discount calculation"
> "What boundary conditions are missing from tests?"
```

## Profiles for Interactive Work

**`planning`** - Read-only analysis
- Safe for exploration without side effects
- Good for understanding code before making changes

**`full-auto`** - Autonomous execution (DEFAULT)
- Can make changes automatically
- Use when you trust Codex to implement directly

**`agent-browser`** - Browser automation
- Uses Playwright for web interaction
- Requires approval for sensitive operations

## Best Practices

1. **Start with planning profile**: Begin with `-p planning` to explore before making changes
2. **Use tmux for long sessions**: Launch in a tmux pane to monitor progress
3. **Build context gradually**: Let Codex learn about your codebase through conversation
4. **Follow up iteratively**: Ask clarifying questions based on responses
5. **Switch to exec for simple tasks**: If you just need one answer, use **codex-exec** skill

## When to Switch to codex-exec

Use the **codex-exec** skill (one-shot mode) instead when:
- You have a single, focused question
- Task doesn't require back-and-forth
- Quick code review or edge case check
- Documentation lookup
- Image-based debugging with immediate fix

See the **codex-exec** skill documentation for one-shot query patterns.

## Examples

```bash
# Launch interactive session in current directory
codex

# Launch with specific working directory
codex -C /Users/neo/projects/my-app

# Launch in tmux pane (40% width, right side)
tmux split-window -h -p 40 "codex -C /project -p planning"

# Start planning session, then switch to implementation
codex -C /project -p planning
# After exploration, restart with:
codex -C /project -p full-auto
```
