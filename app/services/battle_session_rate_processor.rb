class BattleSessionRateProcessor
  class SessionNotFoundError < StandardError; end
  class InvalidResultError < StandardError; end
  class ResultConflictError < StandardError; end

  def initialize(user:, token:, battle_rules:)
    @user = user
    @token = token
    @battle_rules = battle_rules
  end

  def complete!(result:)
    unless BattleSession::RESULTS.include?(result)
      raise InvalidResultError, "resultはwinまたはloseである必要があります"
    end

    with_locked_session do |user, session|
      if session.completed?
        if session.result != result
          raise ResultConflictError, "完了済みの試合結果は変更できません"
        end
        next session
      end

      rates = @battle_rules.rates_for(session.difficulty)
      current_internal_rate = BattleRateValue.normalize!(user.internal_rate, "内部レート")
      current_display_rate = BattleRateValue.normalize!(user.display_rate, "表示レート")
      final_internal_rate = final_internal_rate(
        result: result,
        current_rate: current_internal_rate,
        rates: rates
      )
      final_display_rate = if result == "win"
                             current_display_rate + rates.fetch("win_gain") +
                               session.display_rate_win_bonus
                           else
                             current_display_rate
                           end

      user.update!(
        internal_rate: final_internal_rate,
        display_rate: final_display_rate
      )
      session.update!(
        completed: true,
        result: result,
        final_internal_rate: final_internal_rate,
        final_display_rate: final_display_rate
      )
      session
    end
  end

  private

  def with_locked_session
    ApplicationRecord.transaction do
      user = User.lock.find(@user.id)
      session = user.battle_sessions.lock.find_by(token: @token)
      raise SessionNotFoundError, "BattleSessionが見つかりません" if session.nil?

      yield(user, session)
    end
  end

  def final_internal_rate(result:, current_rate:, rates:)
    if result == "win"
      return current_rate + rates.fetch("win_gain")
    end

    [current_rate + rates.fetch("lose_decrease"), 0].max
  end
end
