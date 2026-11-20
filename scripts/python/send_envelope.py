"""Send the sample Service Agreement to one signer.

Usage: python3 send_envelope.py [name] [email]
"""

import sys

from sapi import Config, api, build_service_agreement, fail, get_config


def send_envelope(config: Config, name: str, email: str) -> dict:
    return api(config, "POST", "/v1/envelopes", json_body=build_service_agreement(name, email))


if __name__ == "__main__":
    name = sys.argv[1] if len(sys.argv) > 1 else "Jane Doe"
    email = sys.argv[2] if len(sys.argv) > 2 else "jane.doe@example.com"
    try:
        envelope = send_envelope(get_config(), name, email)
    except Exception as error:  # noqa: BLE001 - print any failure for the reader
        fail(error)
    print(f"Envelope created: {envelope['id']}")
    print(f"Status: {envelope['status']}")
    for recipient in envelope["recipients"]:
        print(f"Recipient {recipient['key']}: {recipient['name']} <{recipient['email']}> ({recipient['status']})")
