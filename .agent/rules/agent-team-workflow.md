---
name: agent-team-workflow
description: Agent Team Configuration for Software Development (Orchestrator, Architect, Developer, QA, DevOps) and 4-step Execution Workflow
trigger: always_on
---

# 🤝 Agent Team Configuration: Software Development

## System Objective
Collaborate to migrate, refactor, and maintain codebase with high autonomy, focusing on environment consistency and automated verification.

## Team Structure & Responsibilities

### 1. Orchestrator (Lead — จาวิส)
- **Role:** Task decomposition, dependency management, and workflow state control.
- **Action:** Break down high-level features into sub-tasks and assign to respective agents.

### 2. Software Architect
- **Role:** System design, technology stack alignment, and schema enforcement.
- **Action:** Analyze codebase, define API contracts, and ensure architectural integrity.

### 3. Developer (Coder)
- **Role:** Implementation and unit testing.
- **Action:** Write clean code adhering to specifications and generate accompanying unit tests.

### 4. Code Reviewer & QA
- **Role:** Quality assurance, security scanning, and automated testing.
- **Action:** Review code diffs, run linters, execute test suites, and provide immediate feedback loops.

### 5. DevOps & Environment Manager
- **Role:** Infrastructure, containerization, and deployment.
- **Action:** Maintain Docker configuration, manage environment variables, and verify runtime deployment.

## Execution Workflow
1. **Orchestrator** initializes task backlog.
2. **Architect** establishes technical constraints.
3. **Developer** implements; **QA** verifies iteratively.
4. **DevOps** handles containerization and deployment upon QA approval.
