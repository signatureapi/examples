"""Django tutorial views: send a contract, sign it in an embedded ceremony, track it with webhooks.

Run: python manage.py runserver
"""

import json
import uuid
from functools import wraps

from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from signatureapi import (ApiError, NotReadyError, WebhookError, api, create_signing_session, download_signed_pdf,
                          get_config, verify_webhook)

# In production these live in your database.
contracts = {}
seen_webhook_ids = set()


def config():
    return get_config({
        "SIGNATUREAPI_KEY": settings.SIGNATUREAPI_KEY,
        "SIGNATUREAPI_BASE_URL": settings.SIGNATUREAPI_BASE_URL,
        "SIGNATUREAPI_WEBHOOK_SECRET": settings.SIGNATUREAPI_WEBHOOK_SECRET,
        "APP_ORIGIN": settings.APP_ORIGIN,
    })


def api_errors(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        try:
            return view(*args, **kwargs)
        except ApiError as error:
            return JsonResponse({"error": str(error)}, status=502)
    return wrapper


@require_GET
def index(request):
    return render(request, "index.html")


# Step 1: your server creates the envelope and hands the ceremony URL to the browser.
@csrf_exempt  # JSON API called by your own page; add your session or token checks here.
@require_POST
@api_errors
def create_contract(request):
    try:
        data = json.loads(request.body)
    except ValueError:
        data = {}
    if not isinstance(data, dict) or not data.get("name") or not data.get("email"):
        return JsonResponse({"error": "name and email are required"}, status=422)
    cfg = config()
    user_id = f"usr_{uuid.uuid4().hex[:8]}"  # your signed-in user's id
    session = create_signing_session(cfg, data["name"], data["email"], user_id)
    contracts[session["envelopeId"]] = {"status": "in_progress", "events": []}
    return JsonResponse(session, status=201)


# Step 4: confirm the real state on the server before acting on a browser event.
@require_GET
@api_errors
def contract_status(request, envelope_id):
    envelope = api(config(), "GET", f"/v1/envelopes/{envelope_id}")
    events = contracts.get(envelope["id"], {}).get("events", [])
    return JsonResponse({"envelopeId": envelope["id"], "status": envelope["status"], "webhookEvents": events})


# Step 5: stream the signed PDF through your server, so the browser never needs your API key.
@require_GET
@api_errors
def signed_pdf(request, envelope_id):
    try:
        pdf = download_signed_pdf(config(), str(envelope_id))
    except NotReadyError as error:
        return JsonResponse({"error": str(error)}, status=409)
    response = HttpResponse(pdf, content_type="application/pdf")
    response["Content-Disposition"] = 'attachment; filename="signed-service-agreement.pdf"'
    return response


# Step 3: SignatureAPI calls this endpoint. Verify the RAW body (request.body), never re-serialized JSON.
@csrf_exempt  # The sender cannot present a CSRF token. The signature is the authentication.
@require_POST
def webhook(request):
    raw = request.body
    headers = {k.lower(): v for k, v in request.headers.items()}
    try:
        event = verify_webhook(settings.SIGNATUREAPI_WEBHOOK_SECRET, headers, raw)
    except WebhookError as error:
        return JsonResponse({"error": str(error)}, status=400)
    webhook_id = headers["webhook-id"]
    if webhook_id in seen_webhook_ids:
        return JsonResponse({"duplicate": True})
    seen_webhook_ids.add(webhook_id)
    envelope_id = event.get("data", {}).get("envelope_id")
    record = contracts.setdefault(envelope_id, {"status": "unknown", "events": []})
    record["events"].append(event["type"])
    if event["type"] == "envelope.completed":
        record["status"] = "completed"
    print(f"webhook {event['type']} for envelope {envelope_id}")
    return JsonResponse({"received": True})
