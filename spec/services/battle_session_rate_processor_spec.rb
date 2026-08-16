require "rails_helper"

RSpec.describe BattleSessionRateProcessor do
  let(:rates) { { "win_gain" => 150, "lose_decrease" => -100 } }
  let(:rules) { instance_double(BattleRules, rates_for: rates) }

  def processor(user, session)
    described_class.new(user: user, token: session.token, battle_rules: rules)
  end

  it "勝利は開始変動を返さずwin_gainだけを加える" do
    user = FactoryBot.create(:user, internal_rate: 1_950, display_rate: 15)
    session = FactoryBot.create(:battle_session, user: user, display_rate_win_bonus: 17)
    completed = processor(user, session).complete!(result: "win")

    expect(user.reload).to have_attributes(internal_rate: 2_100, display_rate: 182)
    expect(completed).to have_attributes(
      result: "win",
      final_internal_rate: 2_100,
      final_display_rate: 182
    )
  end

  it "敗北は負のlose_decreaseをそのまま加える" do
    user = FactoryBot.create(:user, internal_rate: 1_950, display_rate: 15)
    session = FactoryBot.create(:battle_session, user: user)
    processor(user, session).complete!(result: "lose")

    expect(user.reload).to have_attributes(internal_rate: 1_850, display_rate: 15)
  end

  it "敗北時も内部レートを0未満にしない" do
    user = FactoryBot.create(:user, internal_rate: 50, display_rate: 15)
    session = FactoryBot.create(:battle_session, user: user)

    processor(user, session).complete!(result: "lose")

    expect(user.reload).to have_attributes(internal_rate: 0, display_rate: 15)
  end

  it "同じ結果の再送を二重適用せず、異なる結果への変更を拒否する" do
    user = FactoryBot.create(:user, internal_rate: 2000, display_rate: 15)
    session = FactoryBot.create(:battle_session, user: user)
    service = processor(user, session)

    first = service.complete!(result: "win")
    second = service.complete!(result: "win")

    expect(second.id).to eq(first.id)
    expect(user.reload.internal_rate).to eq(2150)
    expect { service.complete!(result: "lose") }
      .to raise_error(described_class::ResultConflictError)
    expect(user.reload.internal_rate).to eq(2150)
  end

  it "別ユーザーのtokenを見つからないものとして拒否する" do
    owner = FactoryBot.create(:user)
    attacker = FactoryBot.create(:user)
    session = FactoryBot.create(:battle_session, user: owner)

    expect { processor(attacker, session).complete!(result: "win") }
      .to raise_error(described_class::SessionNotFoundError)
  end
end
