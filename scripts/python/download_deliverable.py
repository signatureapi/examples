"""Download the signed PDF (deliverable) of a completed envelope.

Usage: python3 download_deliverable.py <envelope-id> [output.pdf]
"""

import sys
import urllib.parse
import urllib.request

from get_status import get_envelope
from sapi import Config, api, fail, get_config


def download_deliverable(config: Config, envelope_id: str, output_path: str) -> dict:
    envelope = get_envelope(config, envelope_id)
    if envelope["status"] != "completed":
        raise RuntimeError(f"Envelope is {envelope['status']}. The deliverable exists once the envelope is completed.")
    if not envelope.get("deliverable"):
        raise RuntimeError("The envelope has no deliverable yet. Try again in a few seconds.")
    deliverable_id = envelope["deliverable"]["id"]
    deliverable = api(config, "GET", f"/v1/deliverables/{urllib.parse.quote(deliverable_id)}")
    if deliverable["status"] != "generated":
        raise RuntimeError(f"Deliverable is {deliverable['status']}. Try again once it is generated.")
    # deliverable["url"] is a pre-signed link that expires after 1 hour. It needs no API key.
    with urllib.request.urlopen(deliverable["url"], timeout=60) as response:
        data = response.read()
    with open(output_path, "wb") as handle:
        handle.write(data)
    return {"deliverable_id": deliverable_id, "bytes": len(data)}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        fail(ValueError("Usage: python3 download_deliverable.py <envelope-id> [output.pdf]"))
    output = sys.argv[2] if len(sys.argv) > 2 else "signed-envelope.pdf"
    try:
        result = download_deliverable(get_config(), sys.argv[1], output)
    except Exception as error:  # noqa: BLE001
        fail(error)
    print(f"Saved deliverable {result['deliverable_id']} to {output} ({result['bytes']} bytes)")
