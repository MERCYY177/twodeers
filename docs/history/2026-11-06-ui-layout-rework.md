# TwoDeers UI layout rework — 2026-11-06

This pass corrects the navigation and settings placement against the established kkk35g-style interaction pattern while preserving the existing TwoDeers data modules and handlers.

## Changes

- Home entry order is now Chat, Moments, Mailbox, Parameters; the mailbox entry is labeled **信箱**.
- The mailbox page title is **信箱**. Its list is labeled **收件箱**; draft handling remains in **草稿箱**.
- Mailbox automation settings are no longer an always-visible panel at the bottom of the mailbox page. They open from the mailbox header's three-dot menu as a focused settings sheet.
- The chat header uses a three-dot menu instead of a standalone phone shortcut. The menu offers **发起通话** and **通话设置**.
- Call settings are no longer shown as a parameter-area category. They are opened from the chat header menu. Returning from that settings page returns to the originating page (chat or parameters).
- The redundant explanatory call-entry row was removed from chat rules.
- The card manager uses top-level tabs: **主字卡**, **最近抽过**, **朋友圈动态**, **朋友圈回复**. Recent draws are a top-level tab immediately after the main card pool, not a section at the bottom of a long page.
- The old duplicate card-pool panel remains hidden for legacy compatibility and is not shown alongside the unified card manager.
- Removed the generic “独立设置页面” subtitle from the category page.

## Verification

- `node tools/verify-source.mjs`: PASS.
- `node --test tests/*.test.mjs`: 76 tests PASS, 0 FAIL.
- Added static UI regression tests for home ordering, mailbox naming, contextual three-dot menus, card tabs, removal of the parameter-area call category, and return navigation.
- Browser interaction smoke test was not run: Playwright is declared in the lockfile but is not installed in this offline environment. A headless Chromium dump attempt timed out before producing a DOM snapshot. Android device testing was not part of this UI-only pass.
- No GitHub branch, `main`, deployment, or remote project was changed.
