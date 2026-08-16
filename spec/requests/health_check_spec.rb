require "rails_helper"

RSpec.describe "Health check", type: :request do
  describe "GET /up" do
    it "returns a fixed response without authentication or a cookie" do
      expect(User).not_to receive(:find_by)
      sql_events = []
      subscriber = ActiveSupport::Notifications.subscribe("sql.active_record") do |*args|
        sql_events << ActiveSupport::Notifications::Event.new(*args)
      end

      get "/up"

      expect(response).to have_http_status(:ok)
      expect(response.body).to eq("OK")
      expect(response.headers).not_to include("Set-Cookie")
      expect(sql_events).to be_empty
    ensure
      ActiveSupport::Notifications.unsubscribe(subscriber) if subscriber
    end
  end
end
