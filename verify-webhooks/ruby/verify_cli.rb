# frozen_string_literal: true

# Usage: SIGNATUREAPI_WEBHOOK_SECRET=whsec_... ruby verify_cli.rb [delivery.json]
# Without an argument it checks the valid case from the shared test vector.
require "json"
require_relative "verify_webhook"

vector = JSON.parse(File.read(File.join(__dir__, "..", "test-vector.json")))
if ARGV[0]
  delivery = JSON.parse(File.read(ARGV[0]))
  now = Time.now.to_i
else
  delivery = vector["cases"][0]
  now = vector["now"]
end
secret = ENV.fetch("SIGNATUREAPI_WEBHOOK_SECRET", vector["secret"])

begin
  SignatureApi.verify_webhook(secret, delivery["headers"], delivery["body"], now: now)
  puts "valid signature"
rescue SignatureApi::WebhookVerificationError => e
  warn "invalid: #{e.message}"
  exit 1
end
