# frozen_string_literal: true

# Send the sample Service Agreement to one signer.
# Usage: ruby send_envelope.rb [name] [email]
require_relative "signatureapi_client"

name, email = ARGV
begin
  args = name && email ? { name: name, email: email } : {}
  envelope = SignatureApiClient.send_envelope(SignatureApiClient.config, **args)
  puts "Envelope created: #{envelope["id"]}"
  puts "Status: #{envelope["status"]}"
  envelope["recipients"].each do |r|
    puts "Recipient #{r["key"]}: #{r["name"]} <#{r["email"]}> (#{r["status"]})"
  end
rescue SignatureApiClient::Error => e
  warn "Error: #{e.message}"
  exit 1
end
