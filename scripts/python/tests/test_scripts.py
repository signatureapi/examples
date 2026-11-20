"""Offline tests against a local mock API, plus a live test that runs only with a test key."""

import json
import os
import re
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from bulk_send_csv import bulk_send, read_rows  # noqa: E402
from download_deliverable import download_deliverable  # noqa: E402
from get_status import get_envelope  # noqa: E402
from sapi import ApiError, Config, api, build_service_agreement, get_config  # noqa: E402
from send_envelope import send_envelope  # noqa: E402

ENVELOPE_ID = "eb4cf433-a8af-4161-b37b-7ef57d423e56"
DELIVERABLE_ID = "del_5hN8sD2jKq7WxZ4mPv9Ta3"
FAKE_KEY = "_".join(["key", "test", "offline"])
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class MockApi(BaseHTTPRequestHandler):
    seen: list = []

    def log_message(self, *args):  # keep test output quiet
        pass

    def _reply(self, status, body, content_type="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        body = json.loads(raw) if raw else None
        MockApi.seen.append({"method": self.command, "path": self.path, "body": body})
        if self.path == "/signed.pdf":
            if self.headers.get("X-API-Key"):
                return self._reply(400, b"key leaked", "text/plain")
            return self._reply(200, b"%PDF-1.4 mock", "application/pdf")
        if self.headers.get("X-API-Key") != FAKE_KEY:
            return self._reply(401, {"title": "Unauthorized", "detail": "Invalid API key"})
        if self.command == "POST" and self.path == "/v1/envelopes":
            if body["recipients"][0]["email"] == "bad@example.com":
                return self._reply(422, {"title": "Unprocessable Entity", "detail": "Invalid email", "errors": []})
            recipients = [{**r, "status": "pending"} for r in body["recipients"]]
            return self._reply(201, {"id": ENVELOPE_ID, "status": "processing", "recipients": recipients})
        if self.command == "GET" and self.path == f"/v1/envelopes/{ENVELOPE_ID}":
            return self._reply(200, {"id": ENVELOPE_ID, "status": "completed", "recipients": [],
                                     "deliverable": {"id": DELIVERABLE_ID, "status": "generated"}})
        if self.command == "GET" and self.path == f"/v1/deliverables/{DELIVERABLE_ID}":
            port = self.server.server_address[1]
            return self._reply(200, {"id": DELIVERABLE_ID, "status": "generated",
                                     "url": f"http://127.0.0.1:{port}/signed.pdf"})
        return self._reply(404, {"title": "Not Found"})

    do_GET = _handle
    do_POST = _handle


class ConfigTests(unittest.TestCase):
    def test_requires_key(self):
        with self.assertRaisesRegex(ValueError, "SIGNATUREAPI_KEY"):
            get_config({})

    def test_refuses_live_keys(self):
        with self.assertRaisesRegex(ValueError, "test mode only"):
            get_config({"SIGNATUREAPI_KEY": "_".join(["key", "live", "x"])})

    def test_base_url(self):
        self.assertEqual(get_config({"SIGNATUREAPI_KEY": FAKE_KEY}).base_url, "https://api.signatureapi.com")
        cfg = get_config({"SIGNATUREAPI_KEY": FAKE_KEY, "SIGNATUREAPI_BASE_URL": "http://x/"})
        self.assertEqual(cfg.base_url, "http://x")

    def test_payload_links_place_and_position(self):
        body = build_service_agreement()
        doc = body["documents"][0]
        self.assertEqual(doc["places"][0]["recipient_key"], body["recipients"][0]["key"])
        self.assertEqual(doc["fixed_positions"][0]["place_key"], doc["places"][0]["key"])


class MockApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), MockApi)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.config = Config(api_key=FAKE_KEY, base_url=f"http://127.0.0.1:{cls.server.server_address[1]}")

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_send(self):
        envelope = send_envelope(self.config, "Jane Doe", "jane.doe@example.com")
        self.assertEqual(envelope["id"], ENVELOPE_ID)
        call = MockApi.seen[-1]
        self.assertEqual((call["method"], call["path"]), ("POST", "/v1/envelopes"))
        self.assertEqual(call["body"]["title"], "Service Agreement")

    def test_status(self):
        self.assertEqual(get_envelope(self.config, ENVELOPE_ID)["status"], "completed")

    def test_download(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "signed.pdf")
            result = download_deliverable(self.config, ENVELOPE_ID, out)
            self.assertEqual(result["deliverable_id"], DELIVERABLE_ID)
            self.assertTrue(Path(out).read_bytes().startswith(b"%PDF"))

    def test_error_carries_status(self):
        with self.assertRaises(ApiError) as ctx:
            api(Config(api_key="wrong", base_url=self.config.base_url), "GET", "/v1/envelopes")
        self.assertEqual(ctx.exception.status, 401)
        self.assertIn("Invalid API key", str(ctx.exception))

    def test_bulk_keeps_going(self):
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as handle:
            handle.write("name,email,customer_ref\nJane Doe,jane.doe@example.com,A1\n"
                         "Bad Row,bad@example.com,A2\nJohn Smith,john.smith@example.com,A3\n")
        try:
            results = bulk_send(self.config, read_rows(handle.name), delay_seconds=0)
        finally:
            os.unlink(handle.name)
        self.assertEqual([r["ok"] for r in results], [True, False, True])
        self.assertIn("422", results[1]["error"])


@unittest.skipUnless(os.environ.get("SIGNATUREAPI_KEY"), "live test: set SIGNATUREAPI_KEY to a test key")
class LiveTests(unittest.TestCase):
    def test_send_poll_download(self):
        config = get_config()
        png = (HERE.parent / "assets" / "acme-mark.png").read_bytes()
        upload = api(config, "POST", "/v1/uploads", data=png, content_type="image/png")
        body = build_service_agreement()
        body["title"] = "Service Agreement (examples repo live test)"
        body["recipients"] = [{
            "key": "client", "type": "automatic_signer", "name": "Jane Doe",
            "signature": {"type": "drawn", "url": upload["url"]},
            "mandate": "Authorized by Acme Corp board resolution 2026-04 (synthetic example)",
        }]
        created = api(config, "POST", "/v1/envelopes", json_body=body)
        self.assertRegex(created["id"], UUID)
        envelope = created
        for _ in range(60):
            if envelope["status"] == "completed" and (envelope.get("deliverable") or {}).get("status") == "generated":
                break
            self.assertNotIn(envelope["status"], ("failed", "canceled"))
            time.sleep(2)
            envelope = get_envelope(config, created["id"])
        self.assertEqual(envelope["status"], "completed")
        with tempfile.TemporaryDirectory() as tmp:
            result = download_deliverable(config, created["id"], os.path.join(tmp, "signed.pdf"))
        self.assertGreater(result["bytes"], 1000)
        print(f"live: envelope {created['id']} completed, deliverable {result['deliverable_id']}")

    def test_send_to_human_signer(self):
        envelope = send_envelope(get_config(), "Jane Doe", "jane.doe@example.com")
        self.assertRegex(envelope["id"], UUID)
        self.assertIn(envelope["status"], ("processing", "in_progress"))


if __name__ == "__main__":
    unittest.main()
