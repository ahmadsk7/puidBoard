---
name: tackle-pr
description: Tackle a PR from pullreqs.md - takes "Dev A" or "Dev B" and outputs the next PR to implement
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Task
---

# Tackle PR for $ARGUMENTS

You are helping implement the next PR for the Virtual DJ Rooms project.

**Input:** `$ARGUMENTS` should be either `Dev A` or `Dev B`

## Step 1: Determine the Next PR

Read `pullreqs.md` and scan for PR headings. A PR is **complete** if its heading contains ✅ (e.g., `## PR 0.1 ✅ —`).

### Dev Lanes

**Dev A (Client + Audio):**
```
PR 0.3 → PR 2.1 → PR 2.2 → PR 2.3 → PR 2.4
                              ↓
PR 3.2 → PR 3.3 → PR 3.4
    ↓
PR 4.2
    ↓
PR 6.1 → PR 6.2
```

**Dev B (Backend + Infra):**
```
PR 0.1 → PR 0.2
    ↓
PR 1.1 → PR 1.2
    ↓     PR 1.3
    ↓     PR 1.4
PR 3.1
    ↓
PR 4.1 → PR 4.3
    ↓
PR 5.1 → PR 5.2 → PR 5.3
```

### Dependency Rules

**Phase 0 (Foundation):**
- PR 0.1 - No dependencies (Dev B starts here)
- PR 0.2 - Depends on PR 0.1
- PR 0.3 - Depends on PR 0.2 (Dev A starts here)

**Phase 1 (Realtime core) - Dev B:**
- PR 1.1 - Depends on PR 0.1, 0.2
- PR 1.2 - Depends on PR 1.1
- PR 1.3 - Depends on PR 1.1
- PR 1.4 - Depends on PR 1.1

**Phase 2 (Frontend UI) - Dev A:**
- PR 2.1 - Depends on PR 0.3
- PR 2.2 - Depends on PR 2.1, PR 1.1
- PR 2.3 - Depends on PR 2.2, PR 1.3
- PR 2.4 - Depends on PR 2.2, PR 1.4

**Phase 3 (Audio engine):**
- PR 3.1 - Depends on PR 0.2 (Dev B, can run parallel)
- PR 3.2 - Depends on PR 2.4, PR 3.1 (Dev A)
- PR 3.3 - Depends on PR 3.2 (Dev A)
- PR 3.4 - Depends on PR 3.3 (Dev A)

**Phase 4 (Sync):**
- PR 4.1 - Depends on PR 1.1 (Dev B)
- PR 4.2 - Depends on PR 3.2, PR 4.1 (Dev A)
- PR 4.3 - Depends on PR 4.1 (Dev B)

**Phase 5 (Production) - Dev B:**
- PR 5.1 - Depends on PR 4.3
- PR 5.2 - Depends on PR 5.1
- PR 5.3 - Depends on PR 5.2

**Phase 6 (Polish) - Dev A:**
- PR 6.1 - Depends on PR 3.3
- PR 6.2 - Depends on PR 6.1

### Finding the Next PR

1. Read `pullreqs.md` and identify all PRs with ✅ (completed)
2. Based on the dev lane ($ARGUMENTS), find the **first PR** in their lane where:
   - The PR does NOT have ✅
   - All its dependencies HAVE ✅
3. Output the next PR number and its details

**If no PR is available** (dependencies not met), report:
- Which PR is next in line
- Which dependencies are blocking (missing ✅)
- Suggest the dev waits or helps with blocking PRs

## Step 2: Output the Next PR

Once determined, output:

```
## Next PR for $ARGUMENTS: PR X.X

**Title:** <from pullreqs.md>
**Objective:** <from pullreqs.md>
**Dependencies:** <list, all should be ✅>
**Files to create/modify:** <from pullreqs.md>
**Acceptance criteria:** <from pullreqs.md>
```

Then ask: "Ready to implement PR X.X? (yes/no)"

## Step 3: Implement the PR (if confirmed)

If the user confirms, proceed with implementation:

1. **Prepare the branch:**
   ```bash
   git fetch origin
   git checkout main
   git pull origin main
   git checkout -b pr-X.X-<short-description>
   ```

2. **Create the required files** as specified in the "Files" section of pullreqs.md

3. **Follow repo conventions:**
   - TypeScript strict mode
   - Shared types/schemas in `/packages/shared`
   - Server code in `/apps/realtime`
   - Client code in `/apps/web`

4. **Implement the acceptance criteria** exactly as specified

5. **Add basic tests** for the new functionality

## Step 4: Create the Pull Request

After implementation:

1. Stage and commit:
   ```bash
   git add <specific files>
   git commit -m "PR X.X: <objective from pullreqs.md>"
   ```

2. Push and create PR:
   ```bash
   git push -u origin pr-X.X-<short-description>
   gh pr create --title "PR X.X: <title>" --body "$(cat <<'EOF'
   ## Objective
   <from pullreqs.md>

   ## Scope
   <from pullreqs.md>

   ## Acceptance checklist
   - [ ] <each criterion>

   ## Tests
   <what was added>
   EOF
   )"
   ```

## Step 5: Mark PR as Complete

After the PR is created:

1. **Update pullreqs.md** - add ✅ to the PR heading:
   - Before: `## PR X.X — Title (Dev X)`
   - After: `## PR X.X ✅ — Title (Dev X)`

2. **Commit and push to main:**
   ```bash
   git checkout main
   git pull origin main
   git add pullreqs.md
   git commit -m "Mark PR X.X as complete in pullreqs.md"
   git push origin main
   ```

This updates the shared record so the other dev knows what's done.

## Important Notes

- The ✅ marker in `pullreqs.md` is the **source of truth** for completion
- If blocked by dependencies, coordinate with the other dev
- For PRs that touch `/packages/shared`, ensure no circular dependencies
- Always validate against acceptance criteria before marking complete
