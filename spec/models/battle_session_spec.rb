require "rails_helper"

RSpec.describe BattleSession, type: :model do
  it "推測困難なtokenと未完了の初期状態を作る" do
    session = FactoryBot.create(:battle_session, token: nil)

    expect(session.token).to be_present
    expect(session.token.length).to be >= 32
    expect(session).not_to be_completed
  end

  it "tokenの重複を拒否する" do
    existing = FactoryBot.create(:battle_session)
    duplicate = FactoryBot.build(:battle_session, token: existing.token)

    expect(duplicate).not_to be_valid
    expect(duplicate.errors[:token]).to be_present
  end

  it "完了時にresultと最終レートを必須にする" do
    session = FactoryBot.build(:battle_session, completed: true)

    expect(session).not_to be_valid
    expect(session.errors[:result]).to be_present
    expect(session.errors[:final_internal_rate]).to be_present
    expect(session.errors[:final_display_rate]).to be_present
  end
end
