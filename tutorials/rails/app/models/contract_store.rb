# In production these live in your database (a unique index on webhook_id dedupes retries).
module ContractStore
  LOCK = Mutex.new
  CONTRACTS = {}
  SEEN = Set.new

  def self.start(envelope_id)
    LOCK.synchronize { CONTRACTS[envelope_id] ||= { status: "in_progress", events: [] } }
  end

  def self.first_delivery?(webhook_id)
    LOCK.synchronize { SEEN.add?(webhook_id) }.present?
  end

  def self.record_event(envelope_id, event_type)
    LOCK.synchronize do
      record = CONTRACTS[envelope_id] ||= { status: "unknown", events: [] }
      record[:events] << event_type
      record[:status] = "completed" if event_type == "envelope.completed"
    end
  end

  def self.events(envelope_id)
    LOCK.synchronize { CONTRACTS.dig(envelope_id, :events).to_a.dup }
  end

  def self.clear
    LOCK.synchronize { CONTRACTS.clear && SEEN.clear }
  end
end
