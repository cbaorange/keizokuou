require "rails_helper"

RSpec.describe BattleRules do
  subject(:rules) { described_class.load! }

  it "既存境界と抽選比率でCPU難易度を決める" do
    expect(rules.select_cpu_difficulty(599, random_value: 0.0)).to eq("super_weak")
    expect(rules.select_cpu_difficulty(599, random_value: 0.5)).to eq("weak")
    expect(rules.select_cpu_difficulty(600, random_value: 0.999)).to eq("normal")
    expect(rules.select_cpu_difficulty(1500, random_value: 0.299)).to eq("weak")
    expect(rules.select_cpu_difficulty(1500, random_value: 0.3)).to eq("normal")
    expect(rules.select_cpu_difficulty(1500, random_value: 0.8)).to eq("hard")
    expect(rules.select_cpu_difficulty(1500, random_value: 0.9)).to eq("super_hard")
  end

  it "現行YAMLのレート値と表示レート補正上限を返す" do
    expect(rules.rates_for("normal")).to eq(
      "win_gain" => 100,
      "lose_decrease" => -300
    )
    expect(rules.battle_start_change).to eq(-50)
    expect(rules.display_rate_win_bonus_max).to eq(100)
  end

  it "戦闘エリアのカード周囲paddingをpx値として返す" do
    expect(rules.battle_area_card_padding_px).to eq(7)
    expect(rules.battle_area_border_radius_ratio).to eq(0.08)
  end

  it "戦闘エリアのカード周囲paddingは0以上の有限数だけを許可する" do
    config = YAML.safe_load_file(Rails.root.join("config/data/battle.yml"))
    config.fetch("battle_area")["card_padding_px"] = 0
    expect { described_class.new(config) }.not_to raise_error

    config.fetch("battle_area")["card_padding_px"] = -1
    expect { described_class.new(config) }
      .to raise_error(BattleRules::ConfigurationError, /battle_area\.card_padding_px.*0以上/)
  end

  it "戦闘エリアの丸角比率は0以上の有限数だけを許可する" do
    config = YAML.safe_load_file(Rails.root.join("config/data/battle.yml"))
    config.fetch("battle_area")["border_radius_ratio"] = 0
    expect { described_class.new(config) }.not_to raise_error

    config.fetch("battle_area")["border_radius_ratio"] = -0.1
    expect { described_class.new(config) }
      .to raise_error(BattleRules::ConfigurationError, /battle_area\.border_radius_ratio.*0以上/)
  end

  it "旧表示レートキーを必要とせず不正な新設定を拒否する" do
    config = YAML.safe_load_file(Rails.root.join("config/data/battle.yml"))
    config.fetch("internal_rate").fetch("difficulty").fetch("normal")["win_gain"] = nil

    expect { described_class.new(config) }
      .to raise_error(BattleRules::ConfigurationError, /normal\.win_gain/)
  end

  it "battle_start_changeは0以下の整数だけを許可する" do
    config = YAML.safe_load_file(Rails.root.join("config/data/battle.yml"))
    config.fetch("internal_rate")["battle_start_change"] = 0
    expect { described_class.new(config) }.not_to raise_error

    config.fetch("internal_rate")["battle_start_change"] = 50
    expect { described_class.new(config) }
      .to raise_error(BattleRules::ConfigurationError, /battle_start_change.*0以下/)
  end

  it "lose_decreaseは0以下の整数だけを許可する" do
    config = YAML.safe_load_file(Rails.root.join("config/data/battle.yml"))
    config.fetch("internal_rate").fetch("difficulty").fetch("normal")["lose_decrease"] = 0
    expect { described_class.new(config) }.not_to raise_error

    config.fetch("internal_rate").fetch("difficulty").fetch("normal")["lose_decrease"] = 300
    expect { described_class.new(config) }
      .to raise_error(BattleRules::ConfigurationError, /normal\.lose_decrease.*0以下/)
  end
end
