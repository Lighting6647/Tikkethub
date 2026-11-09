---
name: anti-ai-slop-production-rules
description: Strict Anti-AI Slop design, autonomous testing, deployment gatekeeper, and interactive completion recommendation protocols
trigger: always_on
---

# 🛡️ Anti-AI Slop & Production-Ready Engineering Protocol

The AI assistant MUST enforce these 4 strict gates across all software engineering and UI/UX tasks:

### 1. Anti-AI Slop & UI/UX Design System
- **Curated Design Tokens**: No default/cliché purple-blue gradient soup. Use curated color palettes (Slate/Zinc/Stone with deliberate brand accent). Use typography with defined hierarchy (Inter, Plus Jakarta Sans). Consistent border radii and 8-pt spacing rhythms.
- **Micro-interactions**: Visual feedback on all interactions (hover, active, focus-visible, disabled). Loading skeletons instead of spinners on blank pages. Elegant Toast alerts instead of native alert().
- **Real Content Layout**: No "Lorem Ipsum". Use domain-accurate mock data (real Thai/English names, real dates, realistic currency and status tags) to test realistic layout constraints.
- **Clean Code Structure**: Strict separation of concerns (Atomic or Feature-based). No monolithic files.

### 2. Autonomous Testing & QA Pipeline
- **E2E & Component Tests**: Automated test suites (Playwright, Cypress, Vitest, Jest) covering every critical user flow.
- **Edge Cases Handling**: Schema/Input validation, Error Boundaries, graceful offline/API error fallback states with retry.
- **Responsive Audit**: Test Mobile (375-430px), Tablet (768-834px), Desktop (1280px+). Zero horizontal scrollbar bugs.
- **Zero Console Errors**: Zero red console errors or unhandled warnings before delivery.

### 3. Deployment & Live Link Gatekeeper
- **Build Check**: `npm run build` passes with zero errors, zero TypeScript errors (`tsc --noEmit`), and zero linter warnings.
- **Auto Smoke Test**: Verify HTTP 200, root DOM rendering, and error-free routing (no 404 or white screen).

### 4. Interactive Feature Recommender (Mandatory Completion Protocol)
Whenever core features are completed and verified:
1. Provide a concise summary.
2. Present 2–3 contextual high-impact feature recommendations:
   - Security/Performance (Rate limiting, caching, optimistic UI)
   - UX/Engagement (Undo action, keyboard shortcuts, auto-save drafts)
   - Data/Operations (CSV/Excel export, audit logs, batch operations)
3. Conclude with exact prompt:
   **"ต้องการให้เพิ่มฟังก์ชันใดใน 3 ข้อนี้ต่อทันทีเลยไหมครับ?"**
