import json
from pathlib import Path
from unittest import mock

from django.test import Client, SimpleTestCase, override_settings

import views

VECTOR = json.loads((Path(__file__).parent.parent.parent / "verify-webhooks" / "test-vector.json").read_text())
CASES = {c["name"]: c for c in VECTOR["cases"]}


def to_wsgi(headers):
    # Django test client takes WSGI-style header names: webhook-id -> HTTP_WEBHOOK_ID.
    return {"HTTP_" + k.upper().replace("-", "_"): v for k, v in headers.items()}


@override_settings(SIGNATUREAPI_WEBHOOK_SECRET=VECTOR["secret"])
class WebhookTests(SimpleTestCase):
    def setUp(self):
        views.seen_ids.clear()
        patcher = mock.patch.object(views, "now", return_value=VECTOR["now"])
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = Client()

    def post(self, name):
        case = CASES[name]
        # data is a str and content_type is not multipart, so Django sends it untouched.
        return self.client.post(
            "/webhooks/signatureapi", data=case["body"], content_type="application/json", **to_wsgi(case["headers"])
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
