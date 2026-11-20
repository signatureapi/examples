# frozen_string_literal: true

require "json"
require "minitest/autorun"
require_relative "verify_webhook"

VECTOR = JSON.parse(File.read(File.join(__dir__, "..", "test-vector.json")))

class VerifyWebhookTest < Minitest::Test
  VECTOR["cases"].each do |c|
    define_method("test_vector_#{c["name"]}") do
      run = lambda do
        SignatureApi.verify_webhook(VECTOR["secret"], c["headers"], c["body"],
                                    now: VECTOR["now"], tolerance_seconds: VECTOR["tolerance_seconds"])
      end
      if c["expect"] == "valid"
        assert_equal true, run.call
      else
        assert_raises(SignatureApi::WebhookVerificationError) { run.call }
      end
    end
  end

  def test_header_names_are_case_insensitive
    c = VECTOR["cases"][0]
    upper = c["headers"].transform_keys(&:upcase)
    assert SignatureApi.verify_webhook(VECTOR["secret"], upper, c["body"], now: VECTOR["now"])
  end
end
