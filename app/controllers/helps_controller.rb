class HelpsController < ApplicationController
  layout "guide"

  skip_before_action :require_authentication, only: :show

  def show
    @partner_options = RegistrationChoiceCatalog.partner_options unless current_user
  end
end
