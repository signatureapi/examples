require "test_helper"

class WebhooksTest < ActionDispatch::IntegrationTest
  VECTOR = JSON.parse(File.read(Rails.root.join("../../verify-webhooks/test-vector.json")))

  setup do
    WebhooksController::SEEN.clear
    Rails.configuration.x.signatureapi_webhook_secret = VECTOR["secret"]
    # Freeze the clock at the vector's "now" so the 5 minute tolerance is deterministic.
    travel_to Time.at(VECTOR["now"])
  end

  teardown { travel_back }

  def deliver(name)
    c = VECTOR["cases"].find { |x| x["name"] == name }
    # A String body is sent byte for byte.
    post "/webhooks/signatureapi", params: c["body"], headers: c["headers"].merge("CONTENT_TYPE" => "application/json")
  end

  test "valid delivery returns 2xx" do
    deliver "valid"
    assert_response :success
  end

  test "a repeated webhook-id is acknowledged as a duplicate" do
    deliver "valid"
    deliver "valid"
    assert_response :success
    assert_equal({ "status" => "duplicate" }, response.parsed_body)
  end

  test "tampered body returns 4xx" do
    deliver "tampered_body"
    assert_response :bad_request
  end

  test "wrong secret returns 4xx" do
    deliver "wrong_secret_signature"
    assert_response :bad_request
  end

  test "missing headers return 4xx" do
    deliver "missing_headers"
    assert_response :bad_request
  end
end
