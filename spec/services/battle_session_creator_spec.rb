require "rails_helper"

RSpec.describe BattleSessionCreator do
  class SequenceBattleRandom
    def initialize(*values)
      @values = values
    end

    def rand(_range = nil)
      @values.shift
    end
  end

  it "nilレートを0として開始変動し、難易度と表示レート乱数を固定する" do
    user = FactoryBot.create(:user, display_rate: nil, internal_rate: nil)
    random = SequenceBattleRandom.new(0.8, 17)

    result = described_class.new(
      user: user,
      battle_rules: BattleRules.load!,
      random: random
    ).call

    expect(result.battle_session).to have_attributes(
      difficulty: "weak",
      display_rate_before_battle: 0,
      display_rate_win_bonus: 17,
      completed: false
    )
    expect(result.internal_rate).to eq(0)
    expect(user.reload.internal_rate).to eq(0)
    expect(user.display_rate).to be_nil
  end

  it "開始変動後の内部レートと新BattleSessionを同じtransactionで確定する" do
    user = FactoryBot.create(:user, display_rate: 25, internal_rate: 2_000)
    result = described_class.new(
      user: user,
      battle_rules: BattleRules.load!,
      random: SequenceBattleRandom.new(0.0, 17)
    ).call

    expect(user.reload.internal_rate).to eq(1_950)
    expect(result.internal_rate).to eq(1_950)
    expect(result.battle_session).to have_attributes(
      user_id: user.id,
      display_rate_before_battle: 25,
      display_rate_win_bonus: 17
    )
  end

  it "BattleSession作成失敗時は開始変動もロールバックする" do
    user = FactoryBot.create(:user, display_rate: 25, internal_rate: 2_000)
    existing = FactoryBot.create(:battle_session, user: user)
    allow(SecureRandom).to receive(:urlsafe_base64).and_return(existing.token)

    expect do
      described_class.new(
        user: user,
        battle_rules: BattleRules.load!,
        random: SequenceBattleRandom.new(0.0, 17)
      ).call
    end.to raise_error(ActiveRecord::RecordInvalid)

    expect(user.reload.internal_rate).to eq(2_000)
    expect(user.battle_sessions.count).to eq(1)
  end

  it "負数レートを補正せずエラーにする" do
    user = FactoryBot.create(:user, display_rate: -1, internal_rate: 0)

    expect do
      described_class.new(
        user: user,
        battle_rules: BattleRules.load!
      ).call
    end.to raise_error(BattleRateValue::InvalidRateError, /表示レート/)
  end
end
