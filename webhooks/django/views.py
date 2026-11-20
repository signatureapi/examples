import json
import time

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from verify_webhook import WebhookVerificationError, verify_webhook

# Production: replace with a shared store (see README). A set only dedupes within one process.
seen_ids = set()


def now():
    return int(time.time())


@csrf_exempt  # The sender cannot present a CSRF token. The signature is the authentication.
@require_POST
def signatureapi_webhook(request):
    # request.body is the raw bytes. Never verify json.dumps(json.loads(...)): the bytes differ.
    raw_body = request.body
    try:
        verify_webhook(settings.SIGNATUREAPI_WEBHOOK_SECRET, request.headers, raw_body, now=now())
    except WebhookVerificationError as error:
        return JsonResponse({"error": str(error)}, status=400)

    webhook_id = request.headers["webhook-id"]
    if webhook_id in seen_ids:
        return JsonResponse({"status": "duplicate"})
    seen_ids.add(webhook_id)

    event = json.loads(raw_body)
    match event["type"]:
        case "envelope.completed":
            print(f"envelope {event['data']['envelope_id']} completed")
        case "recipient.completed":
            print(f"recipient {event['data']['object_id']} completed")
        case "deliverable.generated":
            print(f"deliverable {event['data']['object_id']} is ready")
        case _:
            pass  # Acknowledge event types you do not handle so they are not retried.

    # Respond fast. Hand slow work to a task queue.
    return JsonResponse({"status": "ok"})
