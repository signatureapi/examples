"""Flask tutorial app: send a contract, sign it in an embedded ceremony, track it with webhooks.

Run: flask --app app run
"""

from __future__ import annotations

import uuid

from flask import Flask, Response, jsonify, render_template, request

from signatureapi import (ApiError, Config, NotReadyError, WebhookError, api, create_signing_session, download_signed_pdf,
                          get_config, verify_webhook)


def create_app(config: Config | None = None) -> Flask:
    app = Flask(__name__)
    config = config or get_config()
    # In production these live in your database.
    contracts: dict[str, dict] = {}
    seen_webhook_ids: set[str] = set()

    @app.get("/")
    def index():
        return render_template("index.html")

    # Step 1: your server creates the envelope and hands the ceremony URL to the browser.
    @app.post("/api/contracts")
    def create_contract():
        data = request.get_json(silent=True) or {}
        if not data.get("name") or not data.get("email"):
            return jsonify(error="name and email are required"), 422
        user_id = f"usr_{uuid.uuid4().hex[:8]}"  # your signed-in user's id
        session = create_signing_session(config, data["name"], data["email"], user_id)
        contracts[session["envelopeId"]] = {"status": "in_progress", "events": []}
        return jsonify(session), 201

    # Step 4: confirm the real state on the server before acting on a browser event.
    @app.get("/api/contracts/<uuid:envelope_id>")
    def contract_status(envelope_id):
        envelope = api(config, "GET", f"/v1/envelopes/{envelope_id}")
        events = contracts.get(envelope["id"], {}).get("events", [])
        return jsonify(envelopeId=envelope["id"], status=envelope["status"], webhookEvents=events)

    # Step 5: stream the signed PDF through your server, so the browser never needs your API key.
    @app.get("/api/contracts/<uuid:envelope_id>/signed.pdf")
    def signed_pdf(envelope_id):
        try:
            pdf = download_signed_pdf(config, str(envelope_id))
        except NotReadyError as error:
            return jsonify(error=str(error)), 409
        return Response(pdf, mimetype="application/pdf",
                        headers={"Content-Disposition": 'attachment; filename="signed-service-agreement.pdf"'})

    # Step 3: SignatureAPI calls this endpoint. Verify the RAW body (request.get_data), never re-serialized JSON.
    @app.post("/webhooks/signatureapi")
    def webhook():
        raw = request.get_data()
        headers = {k.lower(): v for k, v in request.headers.items()}
        try:
            event = verify_webhook(config.webhook_secret, headers, raw)
        except WebhookError as error:
            return jsonify(error=str(error)), 400
        webhook_id = headers["webhook-id"]
        if webhook_id in seen_webhook_ids:
            return jsonify(duplicate=True), 200
        seen_webhook_ids.add(webhook_id)
        envelope_id = event.get("data", {}).get("envelope_id")
        record = contracts.setdefault(envelope_id, {"status": "unknown", "events": []})
        record["events"].append(event["type"])
        if event["type"] == "envelope.completed":
            record["status"] = "completed"
        app.logger.info("webhook %s for envelope %s", event["type"], envelope_id)
        return jsonify(received=True), 200

    @app.errorhandler(ApiError)
    def api_error(error: ApiError):
        return jsonify(error=str(error)), 502

    return app


if __name__ == "__main__":
    create_app().run(port=5000)
