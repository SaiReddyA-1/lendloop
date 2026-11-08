# n8n end-to-end results

Run on 2026-11-08: local Convex (anonymous deployment), n8n 2.46.6 installed via npm (published workflows), an SMTP capture sink on 127.0.0.1:1025 standing in for Mailpit (binary download was not possible). Secrets were random and set only in Convex env / shell. Addresses are `@example.com`.

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Valid signed event | PASS | HTTP 200 `{"status":"delivered"}`; `.eml` captured; subject "New borrow request for ..." |
| 1b | HTML escaping | PASS | tool name `Cordless <b>drill</b>` rendered as `&lt;b&gt;drill&lt;/b&gt;` in the HTML part |
| 2 | Replay same eventId | PASS | 200 `{"status":"duplicate"}`, no second email |
| 3 | Bad signature / stale timestamp (-400 s) | PASS | both 401 `{"error":"invalid_signature"}`, no email |
| 4 | Convex -> n8n real delivery | PASS | `seed:run` created a pending loan; `automationEvents` row `status: delivered`, `attempts: 1`, ~140 ms; email captured |
| 5 | Overdue reminders (WF2 via `n8n execute`) | PASS | 3 reminder emails, 3 `reminders` rows (201); second run: 0 emails, 0 rows; direct duplicate POST twice -> 200 `duplicate`; exactly 3 rows |
| 6 | Inbound auth | PASS | wrong/missing bearer -> 401 `{"error":"unauthorized"}` |
| 7 | Error workflow | PASS | signed event with unsupported `eventType` -> WF1 HTTP 500; admin alert email captured; `workflowErrors` row: nodeName "Compose email", message "Unsupported eventType [line 44]", no payload |
| 8 | Email outage and Convex retry | PASS | SMTP sink stopped: `lastErrorCode` TIMEOUT, status `pending`, `nextAttemptAt` +30 s; sink restarted: attempt 2 delivered, email captured |

Note: the timeout in scenario 8 led to raising `DELIVERY_TIMEOUT_MS` to 30 s (ADR-028). An early 404 (`HTTP_404`, event failed permanently) happened because the workflows were published but n8n had not been restarted (see README gotchas).

## Reproduce

```bash
# Convex env (values from your shell, never committed)
npx convex env set N8N_WEBHOOK_URL http://127.0.0.1:5678/webhook/lendloop-loan-events
npx convex env set N8N_WEBHOOK_SECRET "$WEBHOOK_SECRET"
npx convex env set N8N_INBOUND_TOKEN "$INBOUND_TOKEN"
# n8n (see README "without Docker"), then:
N8N_CMD="npx n8n" LENDLOOP_INBOUND_TOKEN="$INBOUND_TOKEN" node n8n/scripts/bootstrap.mjs
# restart n8n, then
npx convex run seed:run                    # 1, 4: pending request -> signed webhook -> email
npx convex data automationEvents           # status delivered
# 2, 3: send the same body with a valid / wrong / old (-400 s) signature:
#   sig = HMAC_SHA256(secret, "<ts>.<rawBody>"), headers X-LendLoop-Timestamp / X-LendLoop-Signature
# 5: run WF2 once and again (CLI needs another broker port while n8n is running)
N8N_RUNNERS_BROKER_PORT=5689 npx n8n execute --id=lendloopWf02
npx convex data reminders
# 6: curl -H "Authorization: Bearer wrong" http://127.0.0.1:3211/api/n8n/health   -> 401
# 7, 8: send an event with an unknown eventType; stop the SMTP catcher and trigger an event
npx convex data workflowErrors
```
