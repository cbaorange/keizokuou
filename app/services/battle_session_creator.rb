class BattleSessionCreator
  Result = Struct.new(:battle_session, :internal_rate, keyword_init: true)

  def initialize(user:, battle_rules:, random: Random)
    @user = user
    @battle_rules = battle_rules
    @random = random
  end

  def call
    ApplicationRecord.transaction do
      user = User.lock.find(@user.id)
      current_internal_rate = BattleRateValue.normalize!(user.internal_rate, "内部レート")
      display_rate = BattleRateValue.normalize!(user.display_rate, "表示レート")
      difficulty = @battle_rules.select_cpu_difficulty(
        display_rate,
        random_value: @random.rand
      )
      # displayRateWinBonusには、勝利時に使う0から設定上限までの固定乱数を格納する。
      display_rate_win_bonus = @random.rand(0..@battle_rules.display_rate_win_bonus_max)
      internal_rate = [current_internal_rate + @battle_rules.battle_start_change, 0].max

      user.update!(internal_rate: internal_rate)
      battle_session = user.battle_sessions.create!(
        difficulty: difficulty,
        display_rate_before_battle: display_rate,
        display_rate_win_bonus: display_rate_win_bonus
      )

      Result.new(battle_session: battle_session, internal_rate: internal_rate)
    end
  end
end
