Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check

  root "pages#index"
  post "api/contracts" => "contracts#create"
  get "api/contracts/:id" => "contracts#show", constraints: { id: SignatureApi::UUID }
  get "api/contracts/:id/signed.pdf" => "contracts#signed_pdf", constraints: { id: SignatureApi::UUID }, format: false
  post "webhooks/signatureapi" => "webhooks#create"
end
