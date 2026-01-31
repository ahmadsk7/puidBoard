---
name: tackle-pr
description: Tackle a PR from pullreqs.md - checks dependencies, creates feature branch, implements, and opens PR
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Task
---

# Tackle PR $ARGUMENTS

You are helping implement a PR from the Virtual DJ Rooms project. The PR number is: **$ARGUMENTS**

## Step 1: Load PR Specs and Dependencies

Read the PR breakdown document at `pullreqs.md` to understand:
1. The full scope of PR $ARGUMENTS (objective, scope, acceptance criteria, files)
2. The dependency chain for this PR

## Step 2: Check Dependencies

Based on `pullreqs.md`, verify that all blocking PRs have been merged. The dependency rules are:

**Phase 0 (Foundation):**
- PR 0.1 - No dependencies (must land first)
- PR 0.2 - Depends on PR 0.1
- PR 0.3 - Depends on PR 0.2

**Phase 1 (Realtime core):**
- PR 1.1 - Depends on PR 0.1, 0.2
- PR 1.2 - Depends on PR 1.1
- PR 1.3 - Depends on PR 1.1
- PR 1.4 - Depends on PR 1.1

**Phase 2 (Frontend UI):**
- PR 2.1 - Depends on PR 0.3
- PR 2.2 - Depends on PR 2.1, PR 1.1
- PR 2.3 - Depends on PR 2.2, PR 1.3
- PR 2.4 - Depends on PR 2.2, PR 1.4

**Phase 3 (Audio engine):**
- PR 3.1 - Depends on PR 0.2 (can run parallel)
- PR 3.2 - Depends on PR 2.4, PR 3.1
- PR 3.3 - Depends on PR 3.2
- PR 3.4 - Depends on PR 3.3

**Phase 4 (Sync):**
- PR 4.1 - Depends on PR 1.1
- PR 4.2 - Depends on PR 3.2, PR 4.1
- PR 4.3 - Depends on PR 4.1

**Phase 5 (Production):**
- PR 5.1 - Depends on PR 4.3
- PR 5.2 - Depends on PR 5.1
- PR 5.3 - Depends on PR 5.2

**Phase 6 (Polish):**
- PR 6.1 - Depends on PR 3.3
- PR 6.2 - Depends on PR 6.1

**To verify dependencies:**
1. Run `git branch -r` and `gh pr list --state merged` to check what's been merged
2. Look for branches/PRs matching the dependency PR numbers
3. If dependencies are NOT met, STOP and report which PRs need to land first

## Step 3: Prepare the Branch

If dependencies are satisfied:

```bash
# Fetch latest and rebase
git fetch origin
git checkout main
git pull origin main

# Create feature branch
git checkout -b pr-$ARGUMENTS-<short-description>
```

Use a descriptive branch name based on the PR scope (e.g., `pr-0.1-monorepo-scaffold`, `pr-3.2-deck-playback`).

## Step 4: Implement the PR

Based on the scope from `pullreqs.md`:

1. **Create the required files** as specified in the "Files" section
2. **Follow repo conventions:**
   - TypeScript strict mode
   - Shared types/schemas in `/packages/shared`
   - Server code in `/apps/realtime`
   - Client code in `/apps/web`
3. **Implement the acceptance criteria** exactly as specified
4. **Add basic tests** for the new functionality
5. **Ensure types compile** with `pnpm typecheck` (or equivalent)

## Step 5: Create the Pull Request

After implementation is complete:

1. Stage and commit changes with a clear message:
   ```bash
   git add -A
   git commit -m "PR $ARGUMENTS: <objective from pullreqs.md>"
   ```

2. Push the branch:
   ```bash
   git push -u origin pr-$ARGUMENTS-<short-description>
   ```

3. Create the PR using this template from `pullreqs.md`:
   ```
   ## Objective
   <from pullreqs.md>

   ## Scope (what changes)
   <from pullreqs.md>

   ## Non-scope (explicitly not doing)
   <anything explicitly excluded>

   ## Implementation notes
   <key decisions made during implementation>

   ## Tests
   <what tests were added>

   ## Acceptance checklist
   - [ ] <each acceptance criterion from pullreqs.md>

   ## Rollout / flags
   <any feature flags or env vars added>

   ## Screenshots / clips (if UI)
   <for frontend PRs>
   ```

## Important Notes

- If this is PR 0.1 (monorepo scaffold), you'll be creating the initial project structure
- For PRs that touch `/packages/shared`, ensure no circular dependencies
- Always validate against the acceptance criteria before marking complete
- If you encounter blockers, document them clearly
