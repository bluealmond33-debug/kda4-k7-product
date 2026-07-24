"""Verify the active K7 MVP PostgreSQL shape without printing credentials."""

from __future__ import annotations

import argparse
import json
import os

import psycopg


DEFAULT_ENVIRONMENT_VARIABLE = "K7_TEST_DATABASE_URL"
EXPECTED_CORE_TABLES = {"calls", "transcripts", "consultation_cards"}
OPTIONAL_RAG_TABLES = {"rag_documents", "rag_chunks"}
EXPECTED_CARD_CONSTRAINTS = {
    "consultation_cards_schema_version_chk",
    "consultation_cards_active_emotion_status_chk",
    "consultation_cards_emotion_level_chk",
    "consultation_cards_temperature_band_chk",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Verify the active K7 MVP PostgreSQL schema and report row counts "
            "without printing the connection string."
        )
    )
    parser.add_argument(
        "--database-url-env",
        default=DEFAULT_ENVIRONMENT_VARIABLE,
        help=(
            "Environment variable that contains the PostgreSQL connection URL "
            f"(default: {DEFAULT_ENVIRONMENT_VARIABLE})"
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    environment_variable = args.database_url_env
    database_url = os.environ.get(environment_variable)
    if not database_url:
        raise RuntimeError(f"{environment_variable} is not configured")

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
            for table in sorted(EXPECTED_CORE_TABLES)
        }
        jsonb_columns = {
            row[0]: row[1]
            for row in connection.execute(
                """
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'consultation_cards'
                  AND column_name IN ('raw_emotion_result', 'briefing_payload')
                """
            ).fetchall()
        }
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
        schema_version_constraint = connection.execute(
            """
            SELECT pg_get_constraintdef(oid)
            FROM pg_constraint
            WHERE conrelid = 'consultation_cards'::regclass
              AND conname = 'consultation_cards_schema_version_chk'
            """
        ).fetchone()

    missing_core_tables = EXPECTED_CORE_TABLES - tables
    if missing_core_tables:
        raise RuntimeError(
            f"active core table drift: missing={sorted(missing_core_tables)} "
            f"actual={sorted(tables)}"
        )
    unknown_tables = tables - EXPECTED_CORE_TABLES - OPTIONAL_RAG_TABLES
    if unknown_tables:
        raise RuntimeError(f"unknown public tables: {sorted(unknown_tables)}")
    present_rag_tables = tables & OPTIONAL_RAG_TABLES
    if present_rag_tables and present_rag_tables != OPTIONAL_RAG_TABLES:
        raise RuntimeError(
            "optional regulation RAG schema is only partially installed: "
            f"{sorted(present_rag_tables)}"
        )
    if jsonb_columns != {
        "raw_emotion_result": "jsonb",
        "briefing_payload": "jsonb",
    }:
        raise RuntimeError(
            "mvp-1.1 raw_emotion_result/briefing_payload jsonb columns are missing"
        )
    if not EXPECTED_CARD_CONSTRAINTS <= constraints:
        raise RuntimeError("mvp-1.1 consultation-card constraints are missing")
    if (
        schema_version_constraint is None
        or "mvp-1.1" not in schema_version_constraint[0]
    ):
        raise RuntimeError("consultation-card schema version is not mvp-1.1")

    print(
        json.dumps(
            {
                "status": "PASS",
                "core_tables": sorted(EXPECTED_CORE_TABLES),
                "optional_tables": sorted(present_rag_tables),
                "row_counts": counts,
                "jsonb_columns": sorted(jsonb_columns),
                "card_constraints": sorted(EXPECTED_CARD_CONSTRAINTS),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
