class BattleSessionsController < ApplicationController
  def result
    session = processor.complete!(result: params[:result])
    render json: { battleSession: serialized_session(session) }
  rescue BattleSessionRateProcessor::SessionNotFoundError => error
    render_error(error, :not_found)
  rescue BattleSessionRateProcessor::InvalidResultError, BattleRateValue::InvalidRateError,
         BattleRules::ConfigurationError => error
    render_error(error, :unprocessable_entity)
  rescue BattleSessionRateProcessor::ResultConflictError => error
    render_error(error, :conflict)
  end

  private

  def processor
    BattleSessionRateProcessor.new(
      user: current_user,
      token: params[:battle_session_token],
      battle_rules: BattleRules.load!
    )
  end

  def serialized_session(session)
    {
      token: session.token,
      difficulty: session.difficulty,
      displayRateWinBonus: session.display_rate_win_bonus,
      completed: session.completed,
      result: session.result,
      finalInternalRate: session.final_internal_rate,
      finalDisplayRate: session.final_display_rate
    }
  end

  def render_error(error, status)
    render json: {
      success: false,
      error: error.message
    }, status: status
  end
end
