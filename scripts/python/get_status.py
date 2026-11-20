"""Print the status of an envelope and each of its recipients.

Usage: python3 get_status.py <envelope-id>
"""

import sys
import urllib.parse

from sapi import Config, api, fail, get_config


def get_envelope(config: Config, envelope_id: str) -> dict:
    return api(config, "GET", f"/v1/envelopes/{urllib.parse.quote(envelope_id)}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        fail(ValueError("Usage: python3 get_status.py <envelope-id>"))
    try:
        envelope = get_envelope(get_config(), sys.argv[1])
    except Exception as error:  # noqa: BLE001
        fail(error)
    print(f"Envelope {envelope['id']}: {envelope['status']}")
    for recipient in envelope["recipients"]:
        print(f"  {recipient['key']} ({recipient['type']}): {recipient['status']}")
    if envelope.get("deliverable"):
        print(f"Deliverable {envelope['deliverable']['id']}: {envelope['deliverable']['status']}")
