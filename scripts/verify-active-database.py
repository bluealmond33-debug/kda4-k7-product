"""Verify the active K7 MVP PostgreSQL shape without printing credentials."""

from __future__ import annotations

import json
import os

import psycopg


ENVIRONMENT_VARIABLE = "K7_TEST_DATABASE_URL"
EXPECTED_TABLES = {"calls", "transcripts", "consultation_cards"}
EXPECTED_EMOTION_CONSTRAINTS = {
    "consultation_cards_active_emotion_status_chk",
    "consultation_cards_emotion_level_chk",
    "consultation_cards_temperature_band_chk",
}


def main() -> int:
    database_url = os.environ.get(ENVIRONMENT_VARIABLE)
    if not database_url:
        raise RuntimeError(f"{ENVIRONMENT_VARIABLE} is not configured")

    with psycopg.connect(database_url) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_type = 'BASE TABLE'
                """
            ).fetchall()
        }
        counts = {
            table: connection.execute(
                f"SELECT count(*) FROM {table}"
            ).fetchone()[0]
            for table in sorted(EXPECTED_TABLES)
        }
        raw_emotion_column = connection.execute(
            """
            SELECT data_type
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'consultation_cards'
              AND column_name = 'raw_emotion_result'
            """
        ).fetchone()
        constraints = {
            row[0]
            for row in connection.execute(
                """
                SELECT conname
                FROM pg_constraint
                WHERE conrelid = 'consultation_cards'::regclass
                """
            ).fetchall()
        }

    if tables != EXPECTED_TABLES:
        raise RuntimeError(
            f"active table drift: expected={sorted(EXPECTED_TABLES)} "
            f"actual={sorted(tables)}"
        )
    if raw_emotion_column != ("jsonb",):
        raise RuntimeError("raw_emotion_result jsonb column is missing")
    if not EXPECTED_EMOTION_CONSTRAINTS <= constraints:
        raise RuntimeError("audio emotion score-level constraints are missing")

    print(
        json.dumps(
            {
                "status": "PASS",
                "tables": sorted(tables),
                "row_counts": counts,
                "raw_emotion_result": "jsonb",
                "emotion_constraints": sorted(EXPECTED_EMOTION_CONSTRAINTS),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
