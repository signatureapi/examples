require "test_helper"

# Live tests: set SIGNATUREAPI_KEY to a test key. Without it they skip.
class LiveTest < ActiveSupport::TestCase
  setup do
    skip "live test: set SIGNATUREAPI_KEY to a test key" if ENV["SIGNATUREAPI_KEY"].to_s.empty?
    @base_url = (ENV["SIGNATUREAPI_BASE_URL"].presence || "https://api.signatureapi.com").chomp("/")
    @client = SignatureApi::Client.new(ENV["SIGNATUREAPI_KEY"], @base_url, "https://app.acme.example")
  end

  test "create an embedded signing session" do
    session = @client.create_signing_session("Jane Doe", "jane.doe@example.com", "usr_tutorial")
    assert_match(/\A[0-9a-f-]{36}\z/, session[:envelopeId])
    # Never print the ceremony URL: it is a bearer link for the signer.
    assert session[:ceremonyUrl].start_with?("https://")
  end

  # An automatic signer completes the envelope without a person, so the download step runs for real.
  test "download the signed PDF" do
    png = File.binread(Rails.root.join("../../scripts/assets/acme-mark.png"))
    uri = URI("#{@base_url}/v1/uploads")
    upload = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") do |http|
      http.post(uri.path, png, "X-API-Key" => ENV["SIGNATUREAPI_KEY"], "Content-Type" => "image/png")
    end
    assert_equal "201", upload.code

    body = @client.build_contract("Jane Doe", "jane.doe@example.com", "usr_tutorial")
    body[:recipients] = [{
      key: "client", type: "automatic_signer", name: "Jane Doe",
      signature: { type: "drawn", url: JSON.parse(upload.body)["url"] },
      mandate: "Authorized by Acme Corp board resolution 2026-04 (synthetic example)"
    }]
    created = @client.api("POST", "/v1/envelopes", body)

    pdf = nil
    60.times do
      sleep 2
      begin
        pdf = @client.download_signed_pdf(created["id"])
        break
      rescue SignatureApi::NotReadyError
        next
      end
    end
    assert pdf, "the signed PDF was not ready within 120 seconds"
    assert pdf.start_with?("%PDF")
  end
end
