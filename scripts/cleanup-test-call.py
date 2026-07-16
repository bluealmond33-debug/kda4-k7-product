"""Delete one smoke-test call without exposing PostgreSQL credentials."""

from __future__ import annotations

import argparse
import os
from uuid import UUID

import psycopg


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--call-id", required=True)
    parser.add_argument(
        "--database-url-env",
        default="K7_TEST_DATABASE_URL",
        help="Environment variable that contains the test database URL",
    )
    args = parser.parse_args()

    call_id = UUID(args.call_id)
    database_url = os.environ.get(args.database_url_env)
    if not database_url:
        raise RuntimeError(
            f"required cleanup environment variable is missing: "
            f"{args.database_url_env}"
        )

    with psycopg.connect(database_url) as connection:
        deleted = connection.execute(
            "DELETE FROM calls WHERE call_id = %s RETURNING call_id",
            (call_id,),
        ).fetchone()

    if deleted is None:
        raise RuntimeError(f"smoke-test call was not found for cleanup: {call_id}")

    print(f"SMOKE_TEST_ROW_CLEANED call_id={call_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
