class WebhooksController < ApplicationController
  # Production: replace with a shared store (see README). A Set only dedupes within one process.
  SEEN = Set.new
  SEEN_LOCK = Mutex.new

  def create
    # raw_post is the body exactly as received. request.parameters (or params.to_json) would be
    # parsed and re-serialized, and those bytes are not the ones that were signed.
    raw_body = request.raw_post
    headers = %w[webhook-id webhook-timestamp webhook-signature].to_h { |name| [name, request.headers[name]] }

    begin
      SignatureApi.verify_webhook(Rails.configuration.x.signatureapi_webhook_secret, headers, raw_body)
    rescue SignatureApi::WebhookVerificationError => e
      return render json: { error: e.message }, status: :bad_request
    end

    duplicate = SEEN_LOCK.synchronize { !SEEN.add?(headers["webhook-id"]) }
    return render json: { status: "duplicate" } if duplicate

    event = JSON.parse(raw_body)
    case event["type"]
    when "envelope.completed"
      Rails.logger.info("envelope #{event.dig("data", "envelope_id")} completed")
    when "recipient.completed"
      Rails.logger.info("recipient #{event.dig("data", "object_id")} completed")
    when "deliverable.generated"
      Rails.logger.info("deliverable #{event.dig("data", "object_id")} is ready")
    end # Other event types are acknowledged so they are not retried.

    # Respond fast. Hand slow work to a job queue such as Active Job.
    render json: { status: "ok" }
  end
end
