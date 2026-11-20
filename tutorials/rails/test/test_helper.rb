ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"

VECTOR = JSON.parse(File.read(Rails.root.join("../../verify-webhooks/test-vector.json")))
FAKE_KEY = %w[key test offline].join("_")
