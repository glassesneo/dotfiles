{
  delib,
  inputs,
  nodePkgs,
  ...
}: let
in
  delib.module {
    name = "programs.claude-code";

    options = delib.singleEnableOption true;

    home.ifEnabled = {
      programs.claude-code = {
        enable = true;
        package = nodePkgs."@anthropic-ai/claude-code";
        settings = {
          env = {
            DISABLE_AUTOUPDATER = "1";
          };
        };
        memory.text = ''
          # CRITICAL DIRECTIVES

          ## Development Methodology (VERY IMPORTANT)
          - **MUST** use Test-Driven Development (TDD) approach for all code changes
          - Write tests first, then implement features to pass those tests
          - Ensure test coverage for new functionality and bug fixes
          - Run tests frequently during development

          ## AI Assistant Delegation
          - **Codex MCP** (`mcp__codex__codex`): Best for code reading, analysis, and planning refactoring
            - **When to use Codex**:
              - Analyzing the codebase for refactoring opportunities
              - Planning feature implementation before writing code
              - Debugging complex issues by exploring code relationships
              - Understanding unfamiliar codebases and creating implementation plans
            - Treat Codex like a subagent for exploration and planning tasks
            - **Limitation**: Codex is NOT suitable for implementing new features (use Claude Code for implementation)
            - **NEVER** specify `reasoning-effort = "high"` when calling Codex MCP
            - Use gpt-5.1-codex-max as a model when you ask codex for regular tasks
            - Use gpt-5.1-codex-mini as a model when you ask codex for tiny tasks
          - After Codex provides a plan, implement features yourself using TDD approach
          - **Code Review**: **MUST** ask Codex MCP to review changes after implementing features or significant refactorings
            - Use Codex to analyze uncommitted changes for potential issues, bugs, and improvements
            - Provide context about the changes and ask for thorough review
            - Address any concerns raised before committing

          ## Required Tool Usage

          ### Code Exploration and Editing
          - **MUST** use Kiri MCP (`mcp__kiri__context_bundle`) to explore unfamiliar codebases
            - Kiri provides intelligent code context and dependency analysis
          - For file editing, choose the appropriate tool:
            - **MUST** use Morph Fast Apply MCP (`mcp__morph-fast-apply__edit_file`) for large-scale edits (multiple changes, complex refactoring)
            - Use normal Edit tool for small, single changes to conserve Morph's API tokens
            - Fast Apply enables efficient edits with minimal context markers

          ### Web Operations
          - **MUST** use Brave Search MCP or Tavily MCP for web searches
          - **MUST** use Readability MCP to fetch web page contents
          - **NEVER** use builtin web search and fetch tools

          ### CLI Tools
          - Use modern CLI alternatives:
            - `rg` instead of `grep`
            - `fd` instead of `find`

          ### Package Management
          - Use Nix exclusively as package manager
          - Run commands via `nix run nixpkgs#command-name` (note: this takes some time)

          # DEVELOPMENT ENVIRONMENT

          ## Languages & Technologies
          - **Personal Projects**: Zig, TypeScript
          - **University**: Python
          - **Development Environment**: Nix
          - **Neovim Configuration**: Lua

          ## System & Tools
          - **OS**: macOS (Darwin)
          - **Editor**: Neovim
          - **Shell**: zsh (default), nushell
          - **Terminal**: Ghostty
          - **Multiplexer**: Zellij
          - **Package Manager**: Nix only

          ## Technical Context
          - **Interests**: System programming
          - **Experience**: Limited web application development experience
          - **Common Tasks**: Implementing new features in existing software, refactoring

          # COMMUNICATION PREFERENCES
          - Provide formal and detailed responses
          - Follow project-local CLAUDE.md files for code style conventions
        '';
      };
      home.file = {
        ".claude/skills/skill-creator".source = "${inputs.anthropic-skills}/skill-creator";
        ".claude/skills/webapp-design/SKILL.md" = {
          text = ''
            ---
            name: webapp-design
            description: Comprehensive web application design framework covering UI/UX principles, layout patterns, component architecture, responsive design, accessibility, and visual hierarchy. Use when building modern web applications, designing user interfaces, implementing design systems, or creating user-centered digital experiences. Provides practical guidance for both aesthetic design and functional implementation.
            ---

            # Web Application Design

            This skill provides comprehensive guidance for designing and implementing modern, user-centered web applications. It covers both visual design principles and practical implementation patterns.

            ## Core Design Principles

            ### 1. User-Centered Design

            **Understand the User Context**
            - Define primary user personas and their goals
            - Map user journeys and key workflows
            - Identify pain points and friction areas
            - Consider context of use (device, environment, urgency)

            **Prioritize Usability**
            - Make primary actions obvious and accessible
            - Minimize cognitive load through clear hierarchy
            - Provide immediate feedback for user actions
            - Ensure error prevention and graceful error handling

            ### 2. Visual Hierarchy

            **Information Architecture**
            - Structure content in logical, scannable layers
            - Use size, weight, and contrast to establish importance
            - Guide eye movement through deliberate visual flow
            - Group related elements through proximity and containment

            **Typography Scale**
            - Establish clear heading hierarchy (H1 → H6)
            - Use font size ratios for consistency (e.g., 1.25, 1.5, 2.0)
            - Maintain readable body text (16-18px minimum)
            - Limit font families to 2-3 maximum

            **Color Hierarchy**
            - Primary: Brand and key actions (5-10% of interface)
            - Secondary: Supporting actions and accents (10-20%)
            - Neutral: Backgrounds, borders, disabled states (70-85%)
            - Semantic: Success, warning, error, info states

            ### 3. Consistency & Patterns

            **Design System Foundation**
            - Define spacing scale (4px, 8px, 16px, 24px, 32px, 48px, 64px)
            - Establish border radius values (0, 2px, 4px, 8px, 16px)
            - Create shadow scale for depth perception
            - Standardize component states (default, hover, active, disabled, focus)

            **Pattern Library**
            - Reuse established UI patterns users recognize
            - Document component variations and use cases
            - Maintain consistent interaction patterns
            - Create predictable navigation structures

            ## Layout Architecture

            ### Grid Systems

            **Column-Based Layouts**
            - 12-column grid for flexible arrangements
            - Use CSS Grid for complex 2D layouts
            - Apply Flexbox for 1D content flow
            - Maintain consistent gutter spacing (16-32px)

            **Container Strategies**
            - Full-width: Hero sections, media galleries
            - Constrained (1200-1440px): Main content areas
            - Narrow (600-800px): Reading content, forms
            - Multi-column: Dashboards, data tables

            ### Responsive Design

            **Breakpoint Strategy**
            ```
            Mobile:     320px - 767px
            Tablet:     768px - 1023px
            Desktop:    1024px - 1439px
            Wide:       1440px+
            ```

            **Mobile-First Approach**
            - Design for smallest screen first
            - Progressively enhance for larger viewports
            - Use responsive typography (clamp, viewport units)
            - Prioritize vertical scrolling over horizontal

            **Adaptive Patterns**
            - Navigation: Hamburger menu → Full navigation
            - Grid: Single column → Multi-column
            - Tables: Stacked cards → Full table view
            - Forms: Full-width → Multi-column layout

            ### White Space Management

            **Spacing Hierarchy**
            - Micro (4-8px): Component internal spacing
            - Small (12-16px): Related element grouping
            - Medium (24-32px): Section separation
            - Large (48-64px): Major content blocks
            - Extra (96px+): Page sections

            ## Component Design

            ### Navigation Patterns

            **Primary Navigation**
            - Position at top or left sidebar
            - Highlight current location
            - Provide breadcrumbs for depth navigation
            - Support keyboard navigation (Tab, Arrow keys)

            **Mobile Navigation**
            - Hamburger menu with smooth transitions
            - Consider bottom navigation for mobile apps
            - Use slide-out drawer or full-screen overlay
            - Prioritize most important 3-5 items

            ### Form Design

            **Input Field Best Practices**
            - Label above or beside input (never inside as placeholder)
            - Provide clear error messages inline
            - Show validation state (neutral, success, error)
            - Include helpful hints and examples
            - Use appropriate input types (email, tel, number, date)

            **Form Layout**
            - Single column for simplicity
            - Group related fields visually
            - Align labels and inputs consistently
            - Use progressive disclosure for complexity
            - Provide clear primary action button

            **Accessibility Requirements**
            - Associate labels with inputs (for, id)
            - Include ARIA attributes where needed
            - Support keyboard-only interaction
            - Provide focus indicators
            - Enable autocomplete attributes

            ### Data Display

            **Tables**
            - Sticky headers for scrolling
            - Sortable columns with indicators
            - Row hover states for clarity
            - Pagination or infinite scroll
            - Responsive alternatives (cards, lists)
            - Empty states with guidance

            **Cards**
            - Consistent padding and spacing
            - Clear hierarchy (image → title → description → action)
            - Hover states for interactivity
            - Shadow or border for definition
            - Flexible sizing with minimum/maximum widths

            **Lists**
            - Visual separation between items
            - Icon or avatar for recognition
            - Secondary information in muted color
            - Action buttons on hover or always visible
            - Checkboxes for multi-select

            ## Interaction Design

            ### Button Hierarchy

            **Visual Weight**
            - Primary: Filled, high contrast (main action)
            - Secondary: Outlined or subtle fill (alternative action)
            - Tertiary: Text-only (low priority)
            - Destructive: Red/warning color (delete, remove)

            **Button States**
            ```css
            Default:  Base appearance
            Hover:    Darken/lighten 10-20%
            Active:   Press effect (scale, shadow)
            Focus:    Outline or ring (accessibility)
            Disabled: Reduced opacity, no pointer
            Loading:  Spinner, disabled interaction
            ```

            ### Feedback & Loading States

            **Immediate Feedback**
            - Button state changes on click
            - Form field validation on blur
            - Toast notifications for actions
            - Optimistic UI updates

            **Loading Indicators**
            - Skeleton screens for content loading
            - Progress bars for determinate processes
            - Spinners for indeterminate waits
            - Disable interactions during processing

            **Error Handling**
            - Inline field errors with explanation
            - Banner messages for system errors
            - Suggest corrective actions
            - Maintain user-entered data

            ### Micro-interactions

            **Animation Principles**
            - Duration: 200-300ms for UI, 400-600ms for transitions
            - Easing: ease-out for entrances, ease-in for exits
            - Purpose: Direct attention, provide feedback, show relationships
            - Performance: Use transform and opacity for 60fps

            **Common Animations**
            - Button press: slight scale down
            - Card hover: lift with shadow increase
            - Menu open: slide and fade
            - Modal appearance: scale + fade
            - Loading: pulse or skeleton wave

            ## Accessibility (a11y)

            ### WCAG 2.1 AA Compliance

            **Color Contrast**
            - Normal text: 4.5:1 minimum ratio
            - Large text (18pt+): 3:1 minimum ratio
            - Interactive elements: 3:1 against background
            - Never rely on color alone for meaning

            **Keyboard Navigation**
            - All interactive elements focusable
            - Logical tab order (left-to-right, top-to-bottom)
            - Visible focus indicators (2px outline minimum)
            - Support arrow keys in menus/lists
            - Provide skip links for repetitive content

            **Screen Reader Support**
            - Semantic HTML (nav, main, article, aside)
            - ARIA labels for icons and buttons
            - ARIA live regions for dynamic content
            - Alt text for meaningful images
            - Form field associations (label, aria-describedby)

            **Touch Targets**
            - Minimum 44x44px for mobile
            - Adequate spacing between targets (8px minimum)
            - Avoid hover-only interactions
            - Support pinch-to-zoom

            ## Performance Considerations

            ### Optimization Strategies

            **Initial Load**
            - Minimize critical CSS (<14KB ideal)
            - Lazy load images and non-critical content
            - Use system fonts or preload custom fonts
            - Defer non-essential JavaScript
            - Implement code splitting for large apps

            **Runtime Performance**
            - Debounce scroll and resize handlers
            - Use CSS transforms over position changes
            - Implement virtual scrolling for long lists
            - Optimize re-renders in React/Vue/Angular
            - Monitor bundle size and audit dependencies

            **Perceived Performance**
            - Show content progressively
            - Use skeleton screens
            - Implement optimistic UI updates
            - Provide instant feedback
            - Cache frequently accessed data

            ## Design Patterns by Use Case

            ### Dashboard Layouts

            **Structure**
            ```
            [Header with global nav]
            [Sidebar]  [Main Content Area with cards/widgets]
                       [Grid of metrics and charts]
            ```

            **Key Elements**
            - Scannable metrics at top
            - Flexible card-based layout
            - Filter/date range controls
            - Data visualization balance
            - Quick actions accessible

            ### Content-Heavy Applications

            **Reading Experience**
            - Narrow content width (600-800px)
            - Generous line height (1.6-1.8)
            - Sufficient paragraph spacing
            - Clear heading hierarchy
            - Table of contents for navigation

            **Media Handling**
            - Responsive images with srcset
            - Lazy loading for performance
            - Lightbox for full-screen view
            - Captions and credits
            - Loading placeholders

            ### E-commerce Interfaces

            **Product Display**
            - Large, zoomable product images
            - Clear pricing and availability
            - Prominent add-to-cart button
            - Product variations (size, color)
            - Reviews and ratings visible

            **Checkout Flow**
            - Single-page or stepped progress
            - Clear step indicators
            - Form field validation
            - Order summary always visible
            - Trust signals (security badges)

            ## Modern CSS Techniques

            ### CSS Custom Properties (Variables)
            ```css
            :root {
              /* Colors */
              --color-primary: #3b82f6;
              --color-text: #1f2937;
              --color-bg: #ffffff;

              /* Spacing */
              --space-xs: 0.25rem;
              --space-sm: 0.5rem;
              --space-md: 1rem;
              --space-lg: 1.5rem;
              --space-xl: 2rem;

              /* Typography */
              --font-sans: system-ui, sans-serif;
              --font-size-base: 1rem;
              --line-height: 1.6;

              /* Effects */
              --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
              --shadow-md: 0 4px 6px rgba(0,0,0,0.1);
              --radius: 0.5rem;
              --transition: 200ms ease;
            }
            ```

            ### Layout Utilities
            ```css
            /* Container */
            .container {
              width: 100%;
              max-width: 1200px;
              margin-inline: auto;
              padding-inline: var(--space-md);
            }

            /* Flex utilities */
            .flex { display: flex; }
            .flex-col { flex-direction: column; }
            .items-center { align-items: center; }
            .justify-between { justify-content: space-between; }
            .gap-md { gap: var(--space-md); }

            /* Grid utilities */
            .grid { display: grid; }
            .grid-cols-3 { grid-template-columns: repeat(3, 1fr); }
            .grid-gap-md { gap: var(--space-md); }
            ```

            ### Component Patterns
            ```css
            /* Card Component */
            .card {
              background: white;
              border-radius: var(--radius);
              box-shadow: var(--shadow-md);
              padding: var(--space-lg);
              transition: box-shadow var(--transition);
            }

            .card:hover {
              box-shadow: var(--shadow-lg);
            }

            /* Button Component */
            .button {
              padding: var(--space-sm) var(--space-lg);
              border: none;
              border-radius: var(--radius);
              font-weight: 600;
              cursor: pointer;
              transition: all var(--transition);
            }

            .button-primary {
              background: var(--color-primary);
              color: white;
            }

            .button-primary:hover {
              background: var(--color-primary-dark);
            }

            .button-primary:active {
              transform: scale(0.98);
            }
            ```

            ## Design Process Workflow

            ### 1. Discovery & Research
            - Analyze user needs and business goals
            - Review competitor solutions
            - Identify technical constraints
            - Define success metrics

            ### 2. Information Architecture
            - Create content hierarchy
            - Map user flows and journeys
            - Define navigation structure
            - Plan responsive behavior

            ### 3. Wireframing & Prototyping
            - Sketch low-fidelity layouts
            - Test navigation and flows
            - Validate information hierarchy
            - Iterate based on feedback

            ### 4. Visual Design
            - Choose aesthetic direction
            - Define color palette and typography
            - Create component library
            - Design key screens/states

            ### 5. Implementation
            - Write semantic HTML structure
            - Apply CSS styling systematically
            - Add interactive behaviors
            - Test across devices and browsers

            ### 6. Testing & Iteration
            - Conduct usability testing
            - Check accessibility compliance
            - Measure performance metrics
            - Refine based on user feedback

            ## Common Pitfalls to Avoid

            **Design Mistakes**
            - Inconsistent spacing and alignment
            - Poor color contrast (accessibility issue)
            - Too many font sizes/families
            - Unclear call-to-action hierarchy
            - Neglecting empty and error states
            - Ignoring mobile experience

            **Implementation Issues**
            - Non-semantic HTML structure
            - Missing alt text and ARIA labels
            - Inaccessible keyboard navigation
            - Performance bottlenecks (large bundles, unoptimized images)
            - Inconsistent component styling
            - Hard-coded values instead of design tokens

            **UX Problems**
            - Long forms without clear progress
            - Unclear error messages
            - Missing loading feedback
            - Confusing navigation structure
            - No way to undo destructive actions
            - Inconsistent interaction patterns

            ## Tools & Resources

            **Design Tools**
            - Figma, Sketch, Adobe XD for mockups
            - Optimal Workshop for information architecture
            - UserTesting, Maze for usability testing
            - Contrast checkers for accessibility

            **Development Tools**
            - CSS frameworks: Tailwind, Bootstrap (use judiciously)
            - Component libraries: shadcn/ui, Radix UI, Headless UI
            - Animation libraries: Framer Motion, GSAP
            - Icon sets: Lucide, Heroicons, Phosphor

            **Testing Tools**
            - Lighthouse for performance and accessibility
            - axe DevTools for accessibility auditing
            - BrowserStack for cross-browser testing
            - WebPageTest for performance analysis

            ## Checklist for New Web Applications

            **Planning Phase**
            - [ ] User personas and goals defined
            - [ ] Key user flows mapped
            - [ ] Content hierarchy planned
            - [ ] Technical requirements documented

            **Design Phase**
            - [ ] Visual direction chosen and documented
            - [ ] Color palette with contrast ratios verified
            - [ ] Typography scale established
            - [ ] Spacing system defined
            - [ ] Component library created
            - [ ] Responsive breakpoints planned

            **Implementation Phase**
            - [ ] Semantic HTML structure
            - [ ] CSS custom properties for theming
            - [ ] Responsive layout implemented
            - [ ] Interactive states styled
            - [ ] Loading and error states handled
            - [ ] Form validation implemented

            **Quality Assurance**
            - [ ] Keyboard navigation works throughout
            - [ ] Screen reader announces correctly
            - [ ] Color contrast meets WCAG AA
            - [ ] Touch targets 44x44px minimum
            - [ ] Works across major browsers
            - [ ] Mobile experience tested
            - [ ] Performance benchmarks met (Lighthouse >90)
            - [ ] Empty and error states designed

            ## Conclusion

            Great web application design balances aesthetic appeal with functional usability. Prioritize user needs, maintain consistency, ensure accessibility, and continuously iterate based on real usage. Every design decision should serve the user's goals while creating a delightful, memorable experience.
          '';
        };
      };
    };
  }
