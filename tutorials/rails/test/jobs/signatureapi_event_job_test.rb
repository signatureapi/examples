require "test_helper"

class SignatureapiEventJobTest < ActiveJob::TestCase
  setup { ContractStore.clear }

  test "records the event and completes the contract" do
    SignatureapiEventJob.perform_later("env-1", "envelope.completed")
    perform_enqueued_jobs
    assert_equal ["envelope.completed"], ContractStore.events("env-1")
    assert_equal "completed", ContractStore::CONTRACTS["env-1"][:status]
  end
end
