#!/usr/bin/env bash
# SignatureAPI requests for the HTTPie CLI (https://httpie.io/cli), generated from the OpenAPI spec.
# Set SIGNATUREAPI_KEY to a test key first. Copy one command at a time; this file is a reference, not a script to run.
BASE="${SIGNATUREAPI_BASE_URL:-https://api.signatureapi.com}"

# List envelopes (GET /v1/envelopes)
# http GET "$BASE/v1/envelopes" X-API-Key:"$SIGNATUREAPI_KEY"

# Create an envelope (POST /v1/envelopes)
# printf '%s' '{"title":"Service Agreement","message":"Hi, please review and sign the Acme Corp Service Agreement.","metadata":{"customer_ref":"ACME-1001"},"documents":[{"url":"https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf","format":"pdf","places":[{"key":"client_signature","type":"signature","recipient_key":"client"}],"fixed_positions":[{"place_key":"client_signature","page":1,"top":172,"left":210}]}],"recipients":[{"key":"client","type":"signer","name":"Jane Doe","email":"jane.doe@example.com"}]}' | http POST "$BASE/v1/envelopes" X-API-Key:"$SIGNATUREAPI_KEY"

# Delete an envelope (DELETE /v1/envelopes/{envelopeId})
# http DELETE "$BASE/v1/envelopes/eb4cf433-a8af-4161-b37b-7ef57d423e56" X-API-Key:"$SIGNATUREAPI_KEY"

# Retrieve an envelope (GET /v1/envelopes/{envelopeId})
# http GET "$BASE/v1/envelopes/eb4cf433-a8af-4161-b37b-7ef57d423e56" X-API-Key:"$SIGNATUREAPI_KEY"

# Update an envelope (PATCH /v1/envelopes/{envelopeId})
# printf '%s' '{"label":"Acme Corp renewal 2026"}' | http PATCH "$BASE/v1/envelopes/eb4cf433-a8af-4161-b37b-7ef57d423e56" X-API-Key:"$SIGNATUREAPI_KEY"

# Cancel an envelope (POST /v1/envelopes/{envelopeId}/cancel)
# printf '%s' '{"reason":"Superseded by a new version of the agreement"}' | http POST "$BASE/v1/envelopes/eb4cf433-a8af-4161-b37b-7ef57d423e56/cancel" X-API-Key:"$SIGNATUREAPI_KEY"

# Retrieve a recipient (GET /v1/recipients/{recipientId})
# http GET "$BASE/v1/recipients/$RECIPIENT_ID" X-API-Key:"$SIGNATUREAPI_KEY"

# Create ceremony for recipient (POST /v1/recipients/{recipientId}/ceremonies)
# printf '%s' '{"authentication":[{"type":"email_code"}]}' | http POST "$BASE/v1/recipients/$RECIPIENT_ID/ceremonies" X-API-Key:"$SIGNATUREAPI_KEY"

# Replace a recipient (POST /v1/recipients/{recipientId}/replace)
# printf '%s' '{"name":"John Smith","email":"john.smith@example.com"}' | http POST "$BASE/v1/recipients/$RECIPIENT_ID/replace" X-API-Key:"$SIGNATUREAPI_KEY"

# Resend Request To Recipient (POST /v1/recipients/{recipientId}/resend)
# printf '%s' '{"subject_override":"Reminder: please sign the Service Agreement"}' | http POST "$BASE/v1/recipients/$RECIPIENT_ID/resend" X-API-Key:"$SIGNATUREAPI_KEY"

# Retrieve a deliverable (GET /v1/deliverables/{deliverableId})
# http GET "$BASE/v1/deliverables/$DELIVERABLE_ID" X-API-Key:"$SIGNATUREAPI_KEY"

# List deliverables (GET /v1/envelopes/{envelopeId}/deliverables)
# http GET "$BASE/v1/envelopes/eb4cf433-a8af-4161-b37b-7ef57d423e56/deliverables" X-API-Key:"$SIGNATUREAPI_KEY"

# Create a deliverable (POST /v1/envelopes/{envelopeId}/deliverables)
# printf '%s' '{"type":"standard"}' | http POST "$BASE/v1/envelopes/eb4cf433-a8af-4161-b37b-7ef57d423e56/deliverables" X-API-Key:"$SIGNATUREAPI_KEY"

# List envelope events (GET /v1/envelopes/{envelopeId}/events)
# http GET "$BASE/v1/envelopes/eb4cf433-a8af-4161-b37b-7ef57d423e56/events" X-API-Key:"$SIGNATUREAPI_KEY"

# List all events (GET /v1/events)
# http GET "$BASE/v1/events" X-API-Key:"$SIGNATUREAPI_KEY"

# List recipient events (GET /v1/recipients/{recipientId}/events)
# http GET "$BASE/v1/recipients/$RECIPIENT_ID/events" X-API-Key:"$SIGNATUREAPI_KEY"

# Create an Upload (POST /v1/uploads)
# http POST "$BASE/v1/uploads" X-API-Key:"$SIGNATUREAPI_KEY" Content-Type:application/pdf @file

# Retrieve an upload (GET /v1/uploads/{uploadId})
# http GET "$BASE/v1/uploads/$UPLOAD_ID" X-API-Key:"$SIGNATUREAPI_KEY"

# Store an upload (POST /v1/uploads/{uploadId}/store)
# printf '%s' '{"key":"service-agreement-v1"}' | http POST "$BASE/v1/uploads/$UPLOAD_ID/store" X-API-Key:"$SIGNATUREAPI_KEY"

# Create a sender (POST /v1/senders)
# printf '%s' '{"email":"legal@acme.example"}' | http POST "$BASE/v1/senders" X-API-Key:"$SIGNATUREAPI_KEY"

# Delete a sender (DELETE /v1/senders/{senderId})
# http DELETE "$BASE/v1/senders/$SENDER_ID" X-API-Key:"$SIGNATUREAPI_KEY"

# Retrieve a Sender (GET /v1/senders/{senderId})
# http GET "$BASE/v1/senders/$SENDER_ID" X-API-Key:"$SIGNATUREAPI_KEY"
