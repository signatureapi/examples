import json
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import main

VECTOR = json.loads((Path(__file__).parent.parent.parent / "verify-webhooks" / "test-vector.json").read_text())
CASES = {c["name"]: c for c in VECTOR["cases"]}


class WebhookTests(unittest.TestCase):
    def setUp(self):
        main.seen_ids.clear()
        main.app.dependency_overrides[main.get_secret] = lambda: VECTOR["secret"]
        main.app.dependency_overrides[main.get_now] = lambda: VECTOR["now"]
        self.client = TestClient(main.app)

    def tearDown(self):
        main.app.dependency_overrides.clear()

    def post(self, name):
        case = CASES[name]
        # content= sends the body string byte for byte.
        return self.client.post(
            "/webhooks/signatureapi",
            content=case["body"],
            headers={"content-type": "application/json", **case["headers"]},
        )

    def test_valid_delivery_returns_2xx(self):
        self.assertEqual(self.post("valid").status_code, 200)

    def test_repeated_webhook_id_is_a_duplicate(self):
        self.post("valid")
        response = self.post("valid")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "duplicate"})

    def test_tampered_body_returns_4xx(self):
        self.assertEqual(self.post("tampered_body").status_code, 400)

    def test_wrong_secret_returns_4xx(self):
        self.assertEqual(self.post("wrong_secret_signature").status_code, 400)

    def test_missing_headers_return_4xx(self):
        self.assertEqual(self.post("missing_headers").status_code, 400)


if __name__ == "__main__":
    unittest.main()
