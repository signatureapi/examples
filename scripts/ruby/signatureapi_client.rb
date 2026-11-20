# frozen_string_literal: true

require "json"
require "net/http"
require "uri"

# Tiny, dependency-free client for the three calls these scripts need.
module SignatureApiClient
  DEFAULT_BASE_URL = "https://api.signatureapi.com"
  SAMPLE_PDF_URL = "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf"

  class Error < StandardError; end

  class ApiError < Error
    attr_reader :status

    def initialize(status, body)
      @status = status
      super("SignatureAPI returned #{status}: #{body}")
    end
  end

  Config = Struct.new(:api_key, :base_url)

  # Reads SIGNATUREAPI_KEY and SIGNATUREAPI_BASE_URL. Test keys only.
  def self.config(env = ENV)
    key = env["SIGNATUREAPI_KEY"]
    raise Error, "Set SIGNATUREAPI_KEY to your test API key (it starts with key_test_)." if key.nil? || key.empty?
    raise Error, "These examples run in test mode only. Use a key that starts with key_test_." unless key.start_with?("key_test_")

    base = env["SIGNATUREAPI_BASE_URL"]
    base = DEFAULT_BASE_URL if base.nil? || base.empty?
    Config.new(key, base.sub(%r{/+\z}, ""))
  end

  # A one-signer envelope for the sample Service Agreement.
  # The sample PDF has no [[placeholders]], so the signature place uses fixed positions (points, page 1).
  def self.build_service_agreement(name: "Jane Doe", email: "jane.doe@example.com")
    {
      title: "Service Agreement",
      message: "Hi, please review and sign the Acme Corp Service Agreement.",
      metadata: {},
      documents: [{
        url: SAMPLE_PDF_URL,
        format: "pdf",
        places: [{ key: "client_signature", type: "signature", recipient_key: "client" }],
        fixed_positions: [{ place_key: "client_signature", page: 1, top: 172, left: 210 }]
      }],
      recipients: [{ key: "client", type: "signer", name: name, email: email }]
    }
  end

  def self.request(config, method, path, json: nil)
    uri = URI("#{config.base_url}#{path}")
    req = Net::HTTP.const_get(method.to_s.capitalize).new(uri)
    req["X-API-Key"] = config.api_key
    req["Accept"] = "application/json"
    if json
      req["Content-Type"] = "application/json"
      req.body = JSON.generate(json)
    end
    res = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") { |http| http.request(req) }
    raise ApiError.new(res.code.to_i, res.body) unless res.is_a?(Net::HTTPSuccess)

    JSON.parse(res.body)
  end

  def self.send_envelope(config, name: "Jane Doe", email: "jane.doe@example.com")
    request(config, :post, "/v1/envelopes", json: build_service_agreement(name: name, email: email))
  end

  def self.get_envelope(config, envelope_id)
    request(config, :get, "/v1/envelopes/#{URI.encode_www_form_component(envelope_id)}")
  end

  # Saves the signed PDF of a completed envelope. Returns [deliverable_id, byte_count].
  def self.download_deliverable(config, envelope_id, output_path)
    envelope = get_envelope(config, envelope_id)
    unless envelope["status"] == "completed"
      raise Error, "Envelope is #{envelope["status"]}. The deliverable exists once the envelope is completed."
    end
    raise Error, "The envelope has no deliverable yet. Try again in a few seconds." unless envelope["deliverable"]

    deliverable = request(config, :get, "/v1/deliverables/#{URI.encode_www_form_component(envelope["deliverable"]["id"])}")
    unless deliverable["status"] == "generated"
      raise Error, "Deliverable is #{deliverable["status"]}. Try again once it is generated."
    end

    # deliverable["url"] is a pre-signed link that expires after 1 hour. Do not send the API key to it.
    res = Net::HTTP.get_response(URI(deliverable["url"]))
    raise Error, "Download failed with #{res.code}" unless res.is_a?(Net::HTTPSuccess)

    File.binwrite(output_path, res.body)
    [deliverable["id"], res.body.bytesize]
  end
end
