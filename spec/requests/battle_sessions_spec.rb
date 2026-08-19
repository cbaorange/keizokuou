require "rails_helper"

RSpec.describe "BattleSessions", type: :request do
  def authentication_cookie_for(user)
    raw_token = user.issue_authentication_token!
    encrypted_cookie_jar = ActionDispatch::Request.new(
      Rails.application.env_config.dup
    ).cookie_jar
    encrypted_cookie_jar.encrypted[
      ApplicationController::AUTHENTICATION_COOKIE_NAME
    ] = {
      value: { user_id: user.id, raw_token: raw_token },
      expires: 1.year.from_now,
      httponly: true,
      same_site: :lax,
      secure: false,
      path: "/"
    }
    encrypted_cookie_jar.to_header
  end

  def post_json_as(user, path, body)
    post path,
         params: body.to_json,
         headers: {
           "Cookie" => authentication_cookie_for(user),
           "Accept" => "application/json",
           "Content-Type" => "application/json"
         }
  end

  def parsed_response
    JSON.parse(response.body)
  end

  it "開始時変更用routeを公開しない" do
    expect do
      Rails.application.routes.recognize_path("/battle/session/start", method: :post)
    end.to raise_error(ActionController::RoutingError)
  end

  it "保存済み難易度の負のlose_decreaseを敗北時に加える" do
    rates = { "win_gain" => 123, "lose_decrease" => -47 }
    rules = instance_double(BattleRules)
    allow(BattleRules).to receive(:load!).and_return(rules)
    expect(rules).to receive(:rates_for).with("normal").and_return(rates)
    user = FactoryBot.create(:user, internal_rate: 1950, display_rate: 15)
    session = FactoryBot.create(:battle_session, user: user, difficulty: "normal")

    post_json_as(
      user,
      "/battle/session/result",
      battle_session_token: session.token,
      result: "lose",
      difficulty: "super_hard"
    )

    expect(response).to have_http_status(:ok)
    expected_internal_rate = 1950 + rates.fetch("lose_decrease")
    expect(user.reload).to have_attributes(
      internal_rate: expected_internal_rate,
      display_rate: 15
    )
    expect(session.reload).to have_attributes(
      completed: true,
      result: "lose",
      final_internal_rate: expected_internal_rate,
      final_display_rate: 15
    )
  end

  it "勝利結果と表示レート補正を一度だけ保存する" do
    rates = { "win_gain" => 123, "lose_decrease" => -47 }
    rules = instance_double(BattleRules)
    allow(BattleRules).to receive(:load!).and_return(rules)
    expect(rules).to receive(:rates_for).with("normal").once.and_return(rates)
    user = FactoryBot.create(:user, internal_rate: 1950, display_rate: 15)
    session = FactoryBot.create(
      :battle_session,
      user: user,
      difficulty: "normal",
      display_rate_win_bonus: 17
    )
    body = { battle_session_token: session.token, result: "win" }
    expected_internal_rate = 1950 + rates.fetch("win_gain")
    expected_display_rate = 15 + rates.fetch("win_gain") + 17

    post_json_as(user, "/battle/session/result", body)
    expect(response).to have_http_status(:ok)
    expect(user.reload).to have_attributes(
      internal_rate: expected_internal_rate,
      display_rate: expected_display_rate
    )

    post_json_as(user, "/battle/session/result", body)
    expect(response).to have_http_status(:ok)
    expect(user.reload).to have_attributes(
      internal_rate: expected_internal_rate,
      display_rate: expected_display_rate
    )
  end

  it "完了済みSessionへ異なる結果を保存できない" do
    user = FactoryBot.create(:user, internal_rate: 2000, display_rate: 15)
    session = FactoryBot.create(:battle_session, user: user)

    post_json_as(
      user,
      "/battle/session/result",
      battle_session_token: session.token,
      result: "win"
    )
    post_json_as(
      user,
      "/battle/session/result",
      battle_session_token: session.token,
      result: "lose"
    )

    expect(response).to have_http_status(:conflict)
    expect(session.reload.result).to eq("win")
  end

  it "別ユーザーのtokenでは結果保存できない" do
    owner = FactoryBot.create(:user, internal_rate: 2000)
    attacker = FactoryBot.create(:user, internal_rate: 2000)
    session = FactoryBot.create(:battle_session, user: owner)

    post_json_as(
      attacker,
      "/battle/session/result",
      battle_session_token: session.token,
      result: "win"
    )
    expect(response).to have_http_status(:not_found)
    expect(owner.reload.internal_rate).to eq(2000)
    expect(attacker.reload.internal_rate).to eq(2000)
    expect(session.reload).not_to be_completed
  end
end
