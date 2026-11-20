class WebhooksController < ApplicationController
  # Step 3: SignatureAPI calls this endpoint. Verify the RAW body (raw_post), never re-serialized JSON.
  def create
    raw_body = request.raw_post
    headers = %w[webhook-id webhook-timestamp webhook-signature].to_h { |name| [name, request.headers[name]] }

    begin
      SignatureApi.verify_webhook(Rails.configuration.x.signatureapi[:webhook_secret], headers, raw_body)
    rescue SignatureApi::WebhookVerificationError => e
      return render json: { error: e.message }, status: :bad_request
    end

    # Retries repeat the same webhook-id: acknowledge them without processing again.
    return render json: { duplicate: true } unless ContractStore.first_delivery?(headers["webhook-id"])

    event = JSON.parse(raw_body)
    # Respond fast: the job records the event in the background.
    SignatureapiEventJob.perform_later(event.dig("data", "envelope_id"), event["type"])
    render json: { received: true }
  end
end
