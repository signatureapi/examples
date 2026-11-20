"""Send one envelope per row of a CSV file (columns: name,email,customer_ref).

Usage: python3 bulk_send_csv.py signers.csv
"""

import csv
import sys
import time

from sapi import ApiError, Config, api, build_service_agreement, fail, get_config


def read_rows(path: str) -> list[dict[str, str]]:
    with open(path, newline="", encoding="utf-8") as handle:
        return [row for row in csv.DictReader(handle) if any(row.values())]


def bulk_send(config: Config, rows: list[dict[str, str]], delay_seconds: float = 0.25) -> list[dict]:
    """Send envelopes one at a time and keep going when a row fails."""
    results = []
    for index, row in enumerate(rows, start=1):
        payload = build_service_agreement(
            row["name"], row["email"], {"customer_ref": row["customer_ref"], "batch_row": str(index)}
        )
        try:
            envelope = api(config, "POST", "/v1/envelopes", json_body=payload)
            results.append({"row": index, "email": row["email"], "ok": True, "envelope_id": envelope["id"]})
        except ApiError as error:
            results.append({"row": index, "email": row["email"], "ok": False, "error": str(error)})
        if delay_seconds:
            time.sleep(delay_seconds)
    return results


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "signers.csv"
    try:
        results = bulk_send(get_config(), read_rows(path))
    except Exception as error:  # noqa: BLE001
        fail(error)
    for r in results:
        if r["ok"]:
            print(f"row {r['row']} {r['email']}: sent {r['envelope_id']}")
        else:
            print(f"row {r['row']} {r['email']}: FAILED {r['error']}")
    failed = sum(1 for r in results if not r["ok"])
    print(f"{len(results) - failed} sent, {failed} failed")
    sys.exit(1 if failed else 0)
