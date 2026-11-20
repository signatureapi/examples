class PagesController < ApplicationController
  def index
    send_file Rails.root.join("app/views/index.html"), type: "text/html; charset=utf-8", disposition: "inline"
  end
end
