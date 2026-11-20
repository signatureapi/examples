# frozen_string_literal: true

require "json"
require "minitest/autorun"
require "socket"
require "tmpdir"
require_relative "signatureapi_client"

ENVELOPE_ID = "eb4cf433-a8af-4161-b37b-7ef57d423e56"
DELIVERABLE_ID = "del_5hN8sD2jKq7WxZ4mPv9Ta3"
FAKE_KEY = "key_test_fake"

# A minimal HTTP/1.1 mock API on a TCP socket. Records every request it sees.
class MockApi
  attr_reader :seen, :port

  def initialize
    @server = TCPServer.new("127.0.0.1", 0)
    @port = @server.addr[1]
    @seen = []
    @thread = Thread.new { loop { handle(@server.accept) } }
  end

  def stop
    @thread.kill
    @server.close
  end

  def base_url = "http://127.0.0.1:#{@port}"

  private

  def handle(client)
    request_line = client.gets or return
    method, path, = request_line.split(" ")
    headers = {}
    while (line = client.gets) && line != "\r\n"
      k, v = line.chomp.split(": ", 2)
      headers[k.downcase] = v
    end
    raw = headers["content-length"] ? client.read(headers["content-length"].to_i) : ""
    @seen << { method: method, path: path, key: headers["x-api-key"], body: raw.empty? ? nil : JSON.parse(raw) }
    status, type, body = route(method, path, headers)
    client.write("HTTP/1.1 #{status} X\r\nContent-Type: #{type}\r\nContent-Length: #{body.bytesize}\r\nConnection: close\r\n\r\n#{body}")
  ensure
    client&.close
  end

  def json(status, obj) = [status, "application/json", JSON.generate(obj)]

  def route(method, path, headers)
    if path == "/signed.pdf"
      return headers["x-api-key"] ? [400, "text/plain", "key leaked"] : [200, "application/pdf", "%PDF-1.4 mock"]
    end
    return json(401, { title: "Unauthorized" }) unless headers["x-api-key"] == FAKE_KEY

    case [method, path]
    when ["POST", "/v1/envelopes"]
      json(201, { id: ENVELOPE_ID, status: "processing",
                  recipients: [{ key: "client", type: "signer", name: "Jane Doe", email: "jane.doe@example.com", status: "pending" }] })
    when ["GET", "/v1/envelopes/#{ENVELOPE_ID}"]
      json(200, { id: ENVELOPE_ID, status: "completed", recipients: [], deliverable: { id: DELIVERABLE_ID, status: "generated" } })
    when ["GET", "/v1/deliverables/#{DELIVERABLE_ID}"]
      json(200, { id: DELIVERABLE_ID, status: "generated", url: "#{base_url}/signed.pdf" })
    else
      json(404, { title: "Not Found" })
    end
  end
end

class ScriptsTest < Minitest::Test
  def setup
    @mock = MockApi.new
    @config = SignatureApiClient::Config.new(FAKE_KEY, @mock.base_url)
  end

  def teardown
    @mock.stop
  end

  def test_config_requires_a_test_key
    assert_raises(SignatureApiClient::Error) { SignatureApiClient.config({}) }
    err = assert_raises(SignatureApiClient::Error) { SignatureApiClient.config({ "SIGNATUREAPI_KEY" => "key_live_x" }) }
    assert_match(/test mode only/, err.message)
    cfg = SignatureApiClient.config({ "SIGNATUREAPI_KEY" => FAKE_KEY, "SIGNATUREAPI_BASE_URL" => "http://x/" })
    assert_equal "http://x", cfg.base_url
  end

  def test_send_envelope_request_shape
    envelope = SignatureApiClient.send_envelope(@config)
    assert_equal ENVELOPE_ID, envelope["id"]
    req = @mock.seen.first
    assert_equal "POST", req[:method]
    assert_equal "/v1/envelopes", req[:path]
    assert_equal FAKE_KEY, req[:key]
    assert_equal JSON.parse(File.read(File.join(__dir__, "expected-envelope.json"))), req[:body]
  end

  def test_get_envelope_request_shape
    envelope = SignatureApiClient.get_envelope(@config, ENVELOPE_ID)
    assert_equal "completed", envelope["status"]
    req = @mock.seen.first
    assert_equal ["GET", "/v1/envelopes/#{ENVELOPE_ID}", FAKE_KEY], [req[:method], req[:path], req[:key]]
  end

  def test_download_deliverable_never_sends_the_key_to_the_signed_url
    Dir.mktmpdir do |dir|
      out = File.join(dir, "signed.pdf")
      id, size = SignatureApiClient.download_deliverable(@config, ENVELOPE_ID, out)
      assert_equal DELIVERABLE_ID, id
      assert_operator size, :>, 0
      assert File.binread(out).start_with?("%PDF")
    end
    assert_equal ["GET /v1/envelopes/#{ENVELOPE_ID}", "GET /v1/deliverables/#{DELIVERABLE_ID}", "GET /signed.pdf"],
                 @mock.seen.map { |r| "#{r[:method]} #{r[:path]}" }
    assert_nil @mock.seen.last[:key]
  end

  def test_unauthorized_raises_api_error
    bad = SignatureApiClient::Config.new("key_test_wrong", @mock.base_url)
    err = assert_raises(SignatureApiClient::ApiError) { SignatureApiClient.get_envelope(bad, ENVELOPE_ID) }
    assert_equal 401, err.status
  end

  # Live test: runs only with a test key, creates a real test-mode envelope and reads it back.
  def test_live
    skip "SIGNATUREAPI_KEY is not set: skipping the live test" if ENV["SIGNATUREAPI_KEY"].to_s.empty?

    config = SignatureApiClient.config
    envelope = SignatureApiClient.send_envelope(config)
    assert_equal envelope["id"], SignatureApiClient.get_envelope(config, envelope["id"])["id"]
  end
end
