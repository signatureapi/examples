import base64
import hashlib
import hmac
import json
import os
import sys
import threading
import time
import unittest
import urllib.request
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from django.test import Client, SimpleTestCase, override_settings

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import views  # noqa: E402
from signatureapi import (NotReadyError, WebhookError, api, build_contract, create_signing_session,  # noqa: E402
                          download_signed_pdf, get_config, verify_webhook)

VECTOR = json.loads((ROOT.parent.parent / "verify-webhooks" / "test-vector.json").read_text())
ENVELOPE_ID = "eb4cf433-a8af-4161-b37b-7ef57d423e56"
FAKE_KEY = "_".join(["key", "test", "offline"])
DELIVERABLE_ID = "del_5hN8sD2jKq7WxZ4mPv9Ta3"
NEW_ENVELOPE_ID = "688d2c9f-5dbe-4bc4-bd0b-2e0459016be8"


class VectorTests(unittest.TestCase):
    def test_every_case(self):
        for case in VECTOR["cases"]:
            with self.subTest(case["name"]):
                run = lambda: verify_webhook(VECTOR["secret"], case["headers"], case["body"].encode(), now=VECTOR["now"])  # noqa: E731
                if case["expect"] == "valid":
                    self.assertEqual(run()["type"], "envelope.completed")
                else:
                    self.assertRaises(WebhookError, run)


class MockApi(BaseHTTPRequestHandler):
    last_body = None

    def log_message(self, *args):
        pass

    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if self.headers.get("X-API-Key") != FAKE_KEY:
            return self._send(401, {"title": "Unauthorized"})
        MockApi.last_body = json.loads(raw)
        self._send(201, {"id": NEW_ENVELOPE_ID, "status": "processing", "recipients": [{"ceremony": {"url": None}}]})

    def do_GET(self):
        if self.path == "/files/signed.pdf":  # the deliverable URL is pre-signed: no API key
            data = b"%PDF-1.7 mock"
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if self.path == f"/v1/deliverables/{DELIVERABLE_ID}":
            url = f"http://127.0.0.1:{self.server.server_address[1]}/files/signed.pdf"
            return self._send(200, {"id": DELIVERABLE_ID, "status": "generated", "url": url})
        if self.path == f"/v1/envelopes/{NEW_ENVELOPE_ID}":  # the created envelope has finished processing
            return self._send(200, {"id": NEW_ENVELOPE_ID, "status": "in_progress",
                                    "recipients": [{"ceremony": {"url": "https://sign.signatureapi.com/en/start?token=mock"}}]})
        self._send(200, {"id": ENVELOPE_ID, "status": "completed", "deliverable": {"id": DELIVERABLE_ID}})


class AppTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.mock = ThreadingHTTPServer(("127.0.0.1", 0), MockApi)
        threading.Thread(target=cls.mock.serve_forever, daemon=True).start()
        override = override_settings(
            SIGNATUREAPI_KEY=FAKE_KEY,
            SIGNATUREAPI_BASE_URL=f"http://127.0.0.1:{cls.mock.server_address[1]}",
            SIGNATUREAPI_WEBHOOK_SECRET=VECTOR["secret"],
            APP_ORIGIN="https://app.acme.example",
        )
        override.enable()
        cls.addClassCleanup(override.disable)

    @classmethod
    def tearDownClass(cls):
        cls.mock.shutdown()
        cls.mock.server_close()
        super().tearDownClass()

    def setUp(self):
        views.contracts.clear()
        views.seen_webhook_ids.clear()
        # enforce_csrf_checks proves the exempt views work without a CSRF token.
        self.client = Client(enforce_csrf_checks=True)

    def test_page_checks_origin(self):
        html = self.client.get("/").content.decode()
        self.assertIn("event.origin !== CEREMONY_ORIGIN", html)

    def test_create_contract(self):
        response = self.client.post("/api/contracts", {"name": "Jane Doe", "email": "jane.doe@example.com"},
                                    content_type="application/json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["envelopeId"], NEW_ENVELOPE_ID)
        recipient = MockApi.last_body["recipients"][0]
        self.assertEqual(recipient["delivery_type"], "none")
        self.assertEqual(recipient["ceremony"]["embeddable_in"], ["https://app.acme.example"])

    def test_create_requires_fields(self):
        response = self.client.post("/api/contracts", {}, content_type="application/json")
        self.assertEqual(response.status_code, 422)

    def test_webhook_flow(self):
        valid = next(c for c in VECTOR["cases"] if c["name"] == "valid")
        tampered = next(c for c in VECTOR["cases"] if c["name"] == "tampered_body")
        ts = str(int(time.time()))
        key = base64.b64decode(VECTOR["secret"].removeprefix("whsec_"))
        msg_id = valid["headers"]["webhook-id"]
        sig = "v1," + base64.b64encode(hmac.new(key, f"{msg_id}.{ts}.{valid['body']}".encode(), hashlib.sha256).digest()).decode()

        def post(body, webhook_id):
            return self.client.post("/webhooks/signatureapi", body, content_type="application/json",
                                    HTTP_WEBHOOK_ID=webhook_id, HTTP_WEBHOOK_TIMESTAMP=ts, HTTP_WEBHOOK_SIGNATURE=sig)

        self.assertEqual(post(valid["body"], msg_id).json(), {"received": True})
        self.assertEqual(post(valid["body"], msg_id).json(), {"duplicate": True})
        self.assertEqual(post(tampered["body"], "msg_other").status_code, 400)
        status = self.client.get(f"/api/contracts/{ENVELOPE_ID}").json()
        self.assertEqual(status["webhookEvents"], ["envelope.completed"])

    def test_signed_pdf(self):
        response = self.client.get(f"/api/contracts/{ENVELOPE_ID}/signed.pdf")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertIn("signed-service-agreement.pdf", response["Content-Disposition"])
        self.assertTrue(response.content.startswith(b"%PDF"))


@unittest.skipUnless(os.environ.get("SIGNATUREAPI_KEY"), "live test: set SIGNATUREAPI_KEY to a test key")
class LiveTests(unittest.TestCase):
    def test_create_embedded_envelope(self):
        config = replace(get_config(), app_origin="https://app.acme.example")
        session = create_signing_session(config, "Jane Doe", "jane.doe@example.com", "usr_tutorial")
        self.assertRegex(session["envelopeId"], r"^[0-9a-f-]{36}$")
        # Never print the ceremony URL: it is a bearer link for the signer.
        self.assertTrue(session["ceremonyUrl"].startswith("https://"))

    # An automatic signer completes the envelope without a person, so the download step runs for real.
    def test_download_signed_pdf(self):
        config = get_config()
        png = (ROOT.parent.parent / "scripts" / "assets" / "acme-mark.png").read_bytes()
        request = urllib.request.Request(config.base_url + "/v1/uploads", data=png, method="POST",
                                         headers={"X-API-Key": config.api_key, "Content-Type": "image/png"})
        with urllib.request.urlopen(request, timeout=60) as response:
            upload = json.loads(response.read())
        body = build_contract("Jane Doe", "jane.doe@example.com", "usr_tutorial", "https://app.acme.example")
        body["recipients"] = [{
            "key": "client", "type": "automatic_signer", "name": "Jane Doe",
            "signature": {"type": "drawn", "url": upload["url"]},
            "mandate": "Authorized by Acme Corp board resolution 2026-04 (synthetic example)",
        }]
        created = api(config, "POST", "/v1/envelopes", body)
        pdf = None
        for _ in range(60):
            time.sleep(2)
            try:
                pdf = download_signed_pdf(config, created["id"])
                break
            except NotReadyError:
                continue
        self.assertIsNotNone(pdf, "the signed PDF was not ready within 120 seconds")
        self.assertTrue(pdf.startswith(b"%PDF"))
