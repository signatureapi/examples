"""Demo: SIGNATUREAPI_WEBHOOK_SECRET=whsec_... python3 verify_cli.py [delivery.json]

Without an argument it checks the valid case from the shared test vector.
"""

import json
import os
import sys
from pathlib import Path

from verify_webhook import WebhookVerificationError, verify_webhook

vector = json.loads((Path(__file__).parent.parent / "test-vector.json").read_text())
if len(sys.argv) > 1:
    delivery, now = json.loads(Path(sys.argv[1]).read_text()), None
else:
    delivery, now = vector["cases"][0], vector["now"]

try:
    verify_webhook(os.environ.get("SIGNATUREAPI_WEBHOOK_SECRET", vector["secret"]), delivery["headers"], delivery["body"], now=now)
    print("valid signature")
except WebhookVerificationError as error:
    print(f"invalid: {error}", file=sys.stderr)
    sys.exit(1)
