# frozen_string_literal: true

require "base64"
require "openssl"

module SignatureApi
  class WebhookVerificationError < StandardError; end

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
