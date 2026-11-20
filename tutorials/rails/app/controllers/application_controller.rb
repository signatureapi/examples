class ApplicationController < ActionController::API
  rescue_from SignatureApi::ApiError do |error|
    render json: { error: error.message }, status: :bad_gateway
  end
end
