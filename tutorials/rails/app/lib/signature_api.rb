# frozen_string_literal: true

require "base64"
require "json"
require "net/http"
require "openssl"

module SignatureApi
  UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

  class WebhookVerificationError < StandardError; end

  # SignatureAPI answered with an error. The app passes it on as 502.
  class ApiError < StandardError; end

  # The deliverable is not ready yet. The app answers 409 and the user tries again.
  class NotReadyError < StandardError; end

  class Client
    def self.from_config
      config = Rails.configuration.x.signatureapi
      new(config[:key], config[:base_url], config[:app_origin])
    end

    def initialize(key, base_url = "https://api.signatureapi.com", app_origin = "http://localhost:3000", poll_interval: 1)
      raise ArgumentError, "Set SIGNATUREAPI_KEY to a test API key (it starts with key_test_)." unless key.to_s.start_with?("key_test_")

      @key, @base_url, @app_origin, @poll_interval = key, base_url.chomp("/"), app_origin, poll_interval
    end

    # Calls the API and returns the parsed JSON. Raises ApiError on a non-2xx answer.
    def api(method, path, body = nil)
      uri = URI(@base_url + path)
      request = Net::HTTP.const_get(method.capitalize).new(uri, "X-API-Key" => @key, "Accept" => "application/json")
      if body
        request["Content-Type"] = "application/json"
        request.body = JSON.generate(body)
      end
      response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https", read_timeout: 60) { |http| http.request(request) }
      parsed = response.body.to_s.empty? ? nil : (JSON.parse(response.body) rescue nil)
      unless response.is_a?(Net::HTTPSuccess)
        detail = parsed.is_a?(Hash) ? (parsed["detail"] || parsed["title"]) : nil
        raise ApiError, "SignatureAPI returned #{response.code}#{": #{detail}" if detail}"
      end
      parsed
    end

    # Envelope for an embedded ceremony: custom authentication, embeddable_in, no email delivery.
    def build_contract(name, email, user_id)
      {
        title: "Service Agreement",
        metadata: { app_user_id: user_id },
        documents: [{
          url: "https://pub-9cb75390636c4a8a83a6f76da33d7f45.r2.dev/docs-samples/service-agreement.pdf",
          format: "pdf",
          places: [{ key: "client_signature", type: "signature", recipient_key: "client" }],
          fixed_positions: [{ place_key: "client_signature", page: 1, top: 172, left: 210 }]
        }],
        recipients: [{
          key: "client",
          type: "signer",
          name: name,
          email: email,
          delivery_type: "none",
          ceremony: {
            authentication: [{ type: "custom", provider: "Acme Corp Portal", data: { user_id: user_id } }],
            embeddable_in: [@app_origin]
          }
        }]
      }
    end

    # Creates the envelope and waits until it is in_progress: the ceremony opens only after the
    # envelope leaves `processing`. Each read returns a fresh ceremony URL for the same ceremony.
    def create_signing_session(name, email, user_id)
      envelope = api("POST", "/v1/envelopes", build_contract(name, email, user_id))
      30.times do
        break unless envelope["status"] == "processing"

        sleep @poll_interval
        envelope = api("GET", "/v1/envelopes/#{envelope["id"]}")
      end
      raise ApiError, "Envelope is #{envelope["status"]}, not ready for signing" unless envelope["status"] == "in_progress"

      { envelopeId: envelope["id"], ceremonyUrl: envelope["recipients"][0]["ceremony"]["url"] }
    end

    # Downloads the signed PDF of a completed envelope.
    #
    # The deliverable URL is pre-signed and expires after 1 hour, so fetch a fresh one each time
    # instead of storing it. It needs no API key.
    def download_signed_pdf(envelope_id)
      envelope = api("GET", "/v1/envelopes/#{envelope_id}")
      if envelope["status"] != "completed" || envelope["deliverable"].blank?
        raise NotReadyError, "Envelope is #{envelope["status"]}. The signed PDF exists once it is completed."
      end

      deliverable = api("GET", "/v1/deliverables/#{envelope["deliverable"]["id"]}")
      if deliverable["status"] != "generated"
        raise NotReadyError, "Deliverable is #{deliverable["status"]}. Try again in a few seconds."
      end

      response = Net::HTTP.get_response(URI(deliverable["url"]))
      raise ApiError, "Downloading the PDF returned #{response.code}" unless response.is_a?(Net::HTTPSuccess)

      response.body
    end
  end

  # Verify a Standard Webhooks signature. Returns true or raises WebhookVerificationError.
  #
  # headers:  Hash of request headers (names matched case-insensitively).
  # raw_body: the exact bytes received. Never a re-serialized object.
  # now:      Unix seconds, defaults to the clock.
  def self.verify_webhook(secret, headers, raw_body, now: Time.now.to_i, tolerance_seconds: 300)
    lower = headers.to_h { |name, value| [name.to_s.downcase, value] }
    id = lower["webhook-id"]
    timestamp = lower["webhook-timestamp"]
    signature_header = lower["webhook-signature"]
    if [id, timestamp, signature_header].any? { |v| v.nil? || v.empty? }
      raise WebhookVerificationError, "Missing webhook-id, webhook-timestamp or webhook-signature header"
    end
    raise WebhookVerificationError, "Invalid webhook-timestamp" unless timestamp.match?(/\A\d+\z/)
    if (now - timestamp.to_i).abs > tolerance_seconds
      raise WebhookVerificationError, "Timestamp outside the tolerance window"
    end

    key = Base64.strict_decode64(secret.delete_prefix("whsec_"))
    expected = OpenSSL::HMAC.digest("SHA256", key, "#{id}.#{timestamp}.#{raw_body}")

    # The header holds space-separated "v1,<base64>" entries. Any match is enough.
    signature_header.split(" ").each do |entry|
      version, signature = entry.split(",", 2)
      next unless version == "v1" && signature

      candidate = begin
        Base64.strict_decode64(signature)
      rescue ArgumentError
        next
      end
      if candidate.bytesize == expected.bytesize && OpenSSL.fixed_length_secure_compare(candidate, expected)
        return true
      end
    end
    raise WebhookVerificationError, "No matching signature"
  end
end
