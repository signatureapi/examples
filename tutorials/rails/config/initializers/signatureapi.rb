Rails.configuration.x.signatureapi = {
  key: ENV["SIGNATUREAPI_KEY"].to_s,
  base_url: ENV["SIGNATUREAPI_BASE_URL"].presence || "https://api.signatureapi.com",
  webhook_secret: ENV.fetch("SIGNATUREAPI_WEBHOOK_SECRET", ""),
  app_origin: ENV["APP_ORIGIN"].presence || "http://localhost:3000"
}

# Fail fast when `rails server` starts without a test key. Tests and console skip the check.
Rails.application.config.after_initialize { SignatureApi::Client.from_config if defined?(Rails::Server) }
