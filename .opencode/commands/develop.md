---
description: Implement a feature using Dev, Tester and Reviewer agents
agent: orchestrator
---

You are orchestrating the Save\_Link development workflow.

The user's requested task is:

$ARGUMENTS

Follow this workflow strictly.

PHASE 1 — DEVELOPMENT

Use the Dev agent to implement the requested task.

Dev must:

- Inspect the existing application.

- Implement only the requested functionality.

- Follow the existing architecture.

- Run npm run build.

- Report what changed.

PHASE 2 — TESTING

After Dev completes, use the Tester agent.

Tester must:

- Inspect the actual current code.

- Run npm run build.

- Run all available tests.

- Check the requested functionality.

- Look for regressions.

- Do not modify files.

If Tester reports FAILURES:

1. Send the failure details to Dev.

2. Ask Dev to fix ONLY the reported problems.

3. Run Tester again.

Maximum Dev → Tester fix cycles: 3.

If Tester still reports failures after 3 cycles:

STOP and report the unresolved failures to the user.

PHASE 3 — CODE REVIEW

Only when Tester passes, use the Reviewer agent.

Reviewer must:

- Inspect the actual current implementation.

- Check architecture.

- Check security.

- Check maintainability.

- Check requirements compliance.

- Do not modify files.

If Reviewer reports CRITICAL or HIGH problems:

1. Send the findings to Dev.

2. Ask Dev to fix the reported problems.

3. Run Tester again.

4. If Tester passes, run Reviewer again.

Maximum Reviewer → Dev fix cycles: 2.

If Reviewer reports only LOW or non-blocking warnings:

Do not automatically change the code.

Report the warnings to the user.

PHASE 4 — COMPLETION

When:

- Tester passes

- Reviewer has no CRITICAL/HIGH issues

Report:

IMPLEMENTATION COMPLETE

Development:

- What was changed

Testing:

- What passed

- What is blocked/unverified

Review:

- Critical:

- High:

- Medium:

- Low:

Remaining warnings:

Do not deploy.

Do not modify Git.

Do not modify .env.

Do not create commits.

Do not perform unrelated work.
