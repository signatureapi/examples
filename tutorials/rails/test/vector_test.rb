require "test_helper"

class VectorTest < ActiveSupport::TestCase
  VECTOR["cases"].each do |c|
    test "vector case #{c["name"]}" do
      verify = -> { SignatureApi.verify_webhook(VECTOR["secret"], c["headers"], c["body"], now: VECTOR["now"]) }
      if c["expect"] == "valid"
        assert verify.call
      else
        assert_raises(SignatureApi::WebhookVerificationError, &verify)
      end
    end
  end
end
