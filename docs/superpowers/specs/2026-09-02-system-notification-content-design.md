# System Notification Content Design

## Goal

Correct macOS system notification title/body ordering and make notification types immediately recognizable.

## Format

Notifications use the event type as the title and session context as the body:

- Completion title: `✅ Completed` (localized)
- General failure title: `⚠️ Request failed` with a detected 400/500-class status code in parentheses
- Rate-limit title: `🈳 Request limited (429)` (localized)
- Attention title: `⚠️ Attention needed` (localized)
- Body format: `<session title> · <localized detail or error detail>`

HTTP 429 uses a friendly localized retry message instead of exposing a raw provider error. Other failures preserve the useful error detail while moving it to the body. If no status code can be detected, the failure title omits a code.

## Localization

Use the current desktop locale: English, Simplified Chinese, Traditional Chinese, or Japanese. Session titles and provider error details are not translated.

## Scope

Apply formatting to background session completion, failure, and host UI attention notifications. Update notifications remain separate. Preserve notification click behavior, deduplication, preferences, logging, and permission handling.

## Verification

Add pure formatter tests for completion, attention, generic failures, 400/500 errors, 429 errors, and all four locales. Update the real notification event regression spec to assert exact title/body fields. Run typecheck, build, targeted notification tests, and release checks before publishing version 3.0.1.
