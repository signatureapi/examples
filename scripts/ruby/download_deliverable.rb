# frozen_string_literal: true

# Download the signed PDF (deliverable) of a completed envelope.
# Usage: ruby download_deliverable.rb <envelope-id> [output.pdf]
require_relative "signatureapi_client"

envelope_id = ARGV[0] or abort("Usage: ruby download_deliverable.rb <envelope-id> [output.pdf]")
output = ARGV[1] || "signed-envelope.pdf"
begin
  id, size = SignatureApiClient.download_deliverable(SignatureApiClient.config, envelope_id, output)
  puts "Saved deliverable #{id} to #{output} (#{size} bytes)"
rescue SignatureApiClient::Error => e
  warn "Error: #{e.message}"
  exit 1
end
