import os
import time

from fastapi import Depends, FastAPI, HTTPException, Request

from verify_webhook import WebhookVerificationError, verify_webhook

app = FastAPI()

# Production: replace with a shared store (see README). A set only dedupes within one process.
seen_ids: set[str] = set()


def get_secret() -> str:
    return os.environ["SIGNATUREAPI_WEBHOOK_SECRET"]


def get_now() -> int:
    return int(time.time())


@app.post("/webhooks/signatureapi")
async def signatureapi_webhook(
    request: Request,
    secret: str = Depends(get_secret),
    now: int = Depends(get_now),
):
    # request.body() returns the bytes as received. Declaring a pydantic model parameter instead
    # would parse the JSON first, and re-serializing it does not give the bytes that were signed.
    raw_body = await request.body()
    try:
        verify_webhook(secret, dict(request.headers), raw_body, now=now)
    except WebhookVerificationError as error:
        raise HTTPException(status_code=400, detail=str(error))

    webhook_id = request.headers["webhook-id"]
    if webhook_id in seen_ids:
        return {"status": "duplicate"}
    seen_ids.add(webhook_id)

    event = await request.json()
    match event["type"]:
        case "envelope.completed":
            print(f"envelope {event['data']['envelope_id']} completed")
        case "recipient.completed":
            print(f"recipient {event['data']['object_id']} completed")
        case "deliverable.generated":
            print(f"deliverable {event['data']['object_id']} is ready")
        case _:
            pass  # Acknowledge event types you do not handle so they are not retried.

    # Respond fast. Hand slow work to a queue or BackgroundTasks.
    return {"status": "ok"}
