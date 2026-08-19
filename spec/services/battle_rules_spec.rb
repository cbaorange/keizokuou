require "rails_helper"

RSpec.describe BattleRules do
  it "設定された境界と抽選比率でCPU難易度を決める" do
    config = YAML.safe_load_file(Rails.root.join("config/data/battle.yml"))
    difficulty = config.fetch("cpu").fetch("difficulty")
    difficulty["normal_min_display_rate"] = 700
    difficulty["hard_min_display_rate"] = 1_800
    difficulty["high_rate_selection"] = {
      "weak_ratio" => 0.2,
      "normal_ratio" => 0.3,
      "hard_ratio" => 0.1,
      "super_hard_ratio" => 0.4
    }
    rules = described_class.new(config)

    expect(rules.select_cpu_difficulty(699, random_value: 0.0)).to eq("super_weak")
    expect(rules.select_cpu_difficulty(699, random_value: 0.5)).to eq("weak")
    expect(rules.select_cpu_difficulty(700, random_value: 0.999)).to eq("normal")
    expect(rules.select_cpu_difficulty(1_800, random_value: 0.199)).to eq("weak")
    expect(rules.select_cpu_difficulty(1_800, random_value: 0.2)).to eq("normal")
    expect(rules.select_cpu_difficulty(1_800, random_value: 0.5)).to eq("hard")
    expect(rules.select_cpu_difficulty(1_800, random_value: 0.6)).to eq("super_hard")
  end

  it "YAMLから読み込んだレート設定と表示レート補正上限を返す" do
    config = YAML.safe_load_file(Rails.root.join("config/data/battle.yml"))
    configured_rates = { "win_gain" => 123, "lose_decrease" => -47 }
    config.fetch("internal_rate").fetch("difficulty")["normal"] = configured_rates
    config.fetch("internal_rate")["battle_start_change"] = -29
    config.fetch("display_rate")["win_random_bonus_max"] = 73
    expect(YAML).to receive(:safe_load_file)
      .with(Rails.root.join("config", "data", "battle.yml"))
      .and_return(config)

    configured_rules = described_class.load!

    expect(configured_rules.rates_for("normal")).to eq(configured_rates)
    expect(configured_rules.battle_start_change).to eq(-29)
    expect(configured_rules.display_rate_win_bonus_max).to eq(73)
  end

  it "設定された戦闘エリアのpaddingと丸角比率を返す" do
    config = YAML.safe_load_file(Rails.root.join("config/data/battle.yml"))
    config.fetch("battle_area")["card_padding_px"] = 11.5
    config.fetch("battle_area")["border_radius_ratio"] = 0.17
    rules = described_class.new(config)

    expect(rules.battle_area_card_padding_px).to eq(11.5)
    expect(rules.battle_area_border_radius_ratio).to eq(0.17)
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
