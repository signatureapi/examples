class SignatureapiEventJob < ApplicationJob
  queue_as :default

  def perform(envelope_id, event_type)
    ContractStore.record_event(envelope_id, event_type)
    Rails.logger.info("webhook #{event_type} for envelope #{envelope_id}")
  end
end
