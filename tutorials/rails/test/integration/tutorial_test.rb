require "test_helper"
require "puma"

# A local mock of the SignatureAPI, served by Puma on a free port.
class MockApi
  ENVELOPE_ID = "eb4cf433-a8af-4161-b37b-7ef57d423e56".freeze
  NEW_ENVELOPE_ID = "688d2c9f-5dbe-4bc4-bd0b-2e0459016be8".freeze
  DELIVERABLE_ID = "del_5hN8sD2jKq7WxZ4mPv9Ta3".freeze
  CEREMONY_URL = "https://sign.signatureapi.com/en/start?token=mock".freeze

  class << self
    attr_accessor :last_body, :files_request_had_key
  end

  def self.start
    @server = Puma::Server.new(new, Puma::Events.new)
    @server.add_tcp_listener("127.0.0.1", 0)
    @server.run
    "http://127.0.0.1:#{@server.connected_ports.first}"
  end

  def self.stop
    @server.stop(true)
  end

  def call(env)
    method, path = env["REQUEST_METHOD"], env["PATH_INFO"]
    if path == "/files/signed.pdf" # the deliverable URL is pre-signed: no API key check
      self.class.files_request_had_key = env.key?("HTTP_X_API_KEY")
      return [200, { "content-type" => "application/pdf" }, ["%PDF-1.7 mock"]]
    end
    return json(401, title: "Unauthorized") unless env["HTTP_X_API_KEY"] == FAKE_KEY

    if method == "POST" && path == "/v1/envelopes"
      self.class.last_body = JSON.parse(env["rack.input"].read)
      json(201, id: NEW_ENVELOPE_ID, status: "processing", recipients: [{ ceremony: { url: nil } }])
    elsif path == "/v1/envelopes/#{NEW_ENVELOPE_ID}"
      json(200, id: NEW_ENVELOPE_ID, status: "in_progress", recipients: [{ ceremony: { url: CEREMONY_URL } }])
    elsif path == "/v1/envelopes/#{ENVELOPE_ID}"
      json(200, id: ENVELOPE_ID, status: "completed", deliverable: { id: DELIVERABLE_ID })
    elsif path == "/v1/deliverables/#{DELIVERABLE_ID}"
      host = env["HTTP_HOST"]
      json(200, id: DELIVERABLE_ID, status: "generated", url: "http://#{host}/files/signed.pdf")
    else
      json(404, title: "Not found")
    end
  end

  private

  def json(status, body)
    [status, { "content-type" => "application/json" }, [JSON.generate(body)]]
  end
end

class TutorialTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  setup :start_mock
  teardown { MockApi.stop }

  def start_mock
    ContractStore.clear
    Rails.configuration.x.signatureapi = {
      key: FAKE_KEY, base_url: MockApi.start, webhook_secret: VECTOR["secret"],
      app_origin: "https://app.acme.example"
    }
  end

  def signed_headers(body)
    valid = VECTOR["cases"].find { |c| c["name"] == "valid" }
    id = valid["headers"]["webhook-id"]
    timestamp = Time.now.to_i.to_s
    key = Base64.strict_decode64(VECTOR["secret"].delete_prefix("whsec_"))
    signature = "v1," + Base64.strict_encode64(OpenSSL::HMAC.digest("SHA256", key, "#{id}.#{timestamp}.#{body}"))
    { "webhook-id" => id, "webhook-timestamp" => timestamp, "webhook-signature" => signature, "CONTENT_TYPE" => "application/json" }
  end

  test "page checks the ceremony origin" do
    get "/"
    assert_response :success
    assert_includes response.body, "event.origin !== CEREMONY_ORIGIN"
  end

  test "create contract sends an embedded envelope and returns the ceremony URL" do
    post "/api/contracts", params: { name: "Jane Doe", email: "jane.doe@example.com" }, as: :json
    assert_response :created
    assert_equal MockApi::NEW_ENVELOPE_ID, response.parsed_body["envelopeId"]
    assert_equal MockApi::CEREMONY_URL, response.parsed_body["ceremonyUrl"]
    recipient = MockApi.last_body["recipients"][0]
    assert_equal "none", recipient["delivery_type"]
    assert_equal ["https://app.acme.example"], recipient["ceremony"]["embeddable_in"]
    assert_equal "custom", recipient["ceremony"]["authentication"][0]["type"]
  end

  test "create contract requires name and email" do
    post "/api/contracts", params: {}, as: :json
    assert_response :unprocessable_entity
  end

  test "webhook is verified, deduped and recorded by an Active Job" do
    valid = VECTOR["cases"].find { |c| c["name"] == "valid" }
    tampered = VECTOR["cases"].find { |c| c["name"] == "tampered_body" }
    headers = signed_headers(valid["body"])

    assert_enqueued_jobs 1, only: SignatureapiEventJob do
      post "/webhooks/signatureapi", params: valid["body"], headers: headers
      assert_equal({ "received" => true }, response.parsed_body)
    end
    assert_no_enqueued_jobs only: SignatureapiEventJob do
      post "/webhooks/signatureapi", params: valid["body"], headers: headers
      assert_equal({ "duplicate" => true }, response.parsed_body)
    end
    assert_no_enqueued_jobs only: SignatureapiEventJob do
      post "/webhooks/signatureapi", params: tampered["body"], headers: headers.merge("webhook-id" => "msg_other")
      assert_response :bad_request
    end

    perform_enqueued_jobs
    get "/api/contracts/#{MockApi::ENVELOPE_ID}"
    assert_equal ["envelope.completed"], response.parsed_body["webhookEvents"]
  end

  test "signed pdf streams from the pre-signed URL without the API key" do
    get "/api/contracts/#{MockApi::ENVELOPE_ID}/signed.pdf"
    assert_response :success
    assert_equal "application/pdf", response.media_type
    assert_includes response.headers["Content-Disposition"], 'attachment; filename="signed-service-agreement.pdf"'
    assert response.body.start_with?("%PDF")
    assert_equal false, MockApi.files_request_had_key
  end
end
