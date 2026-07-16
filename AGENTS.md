# K7 MVP repository rules

- Active customer input is voice only. Text is an internal STT result, not a customer input mode.
- Active API contract is `database/contracts/mvp_call_response.schema.json` (`mvp-1.0`).
- Active PostgreSQL schema is `database/mvp/schema.sql` (3 tables).
- Do not make masking, auth, audit logs, counselor allocation, or the legacy 12-table schema an MVP dependency.
- Frontend and model code never connect directly to PostgreSQL; only FastAPI reads `DATABASE_URL`.
- Machine enums stay stable (`low`, `high`, `unavailable`); translate them to Korean only in the UI.
- Do not report placeholder emotion, RAG, or routing values as trained/validated model results.
- Keep the nine deployed legacy demo endpoints compatible until their consumers are migrated.

Before committing, run:

```powershell
npm run check
.\.venv\Scripts\python.exe -m pytest backend\tests -q
```

For a deployed environment, run `scripts/smoke-mvp.ps1` with a sample audio file and verify that POST and GET return the same `call_id` and card.
