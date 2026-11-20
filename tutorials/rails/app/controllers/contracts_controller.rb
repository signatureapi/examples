class ContractsController < ApplicationController
  # Step 1: your server creates the envelope and hands the ceremony URL to the browser.
  def create
    name, email = params[:name], params[:email]
    return render json: { error: "name and email are required" }, status: :unprocessable_entity if name.blank? || email.blank?

    user_id = "usr_#{SecureRandom.hex(4)}" # your signed-in user's id
    session = SignatureApi::Client.from_config.create_signing_session(name, email, user_id)
    ContractStore.start(session[:envelopeId])
    render json: session, status: :created
  end

  # Step 4: confirm the real state on the server before acting on a browser event.
  def show
    envelope = SignatureApi::Client.from_config.api("GET", "/v1/envelopes/#{params[:id]}")
    render json: { envelopeId: envelope["id"], status: envelope["status"], webhookEvents: ContractStore.events(envelope["id"]) }
  end

  # Step 5: stream the signed PDF through your server, so the browser never needs your API key.
  def signed_pdf
    pdf = SignatureApi::Client.from_config.download_signed_pdf(params[:id])
    send_data pdf, type: "application/pdf", disposition: 'attachment; filename="signed-service-agreement.pdf"'
  rescue SignatureApi::NotReadyError => e
    render json: { error: e.message }, status: :conflict
  end
end
