# frozen_string_literal: true

# Print the status of an envelope and each of its recipients.
# Usage: ruby get_status.rb <envelope-id>
require_relative "signatureapi_client"

envelope_id = ARGV[0] or abort("Usage: ruby get_status.rb <envelope-id>")
begin
  envelope = SignatureApiClient.get_envelope(SignatureApiClient.config, envelope_id)
  puts "Envelope #{envelope["id"]}: #{envelope["status"]}"
  envelope["recipients"].each { |r| puts "  #{r["key"]} (#{r["type"]}): #{r["status"]}" }
  d = envelope["deliverable"]
  puts "Deliverable #{d["id"]}: #{d["status"]}" if d
rescue SignatureApiClient::Error => e
  warn "Error: #{e.message}"
  exit 1
end
