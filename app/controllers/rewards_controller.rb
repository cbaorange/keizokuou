class RewardsController < ApplicationController
  def show
    @rewards = RewardsCatalog.load!
    @display_rate = BattleRateValue.normalize!(current_user.display_rate, "表示レート")
  end
end
