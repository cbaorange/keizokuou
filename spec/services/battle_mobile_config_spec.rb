require "rails_helper"

RSpec.describe BattleMobileConfig do
  let(:data) do
    YAML.safe_load_file(Rails.root.join("config/data/battle_mobile.yml"))
  end

  it "設定されたraw値と手札幅の導出値をCSS変数へ渡す" do
    mobile = data.fetch("battle_mobile")
    mobile.fetch("user_hand").merge!(
      "card_gap_ratio" => 0.13,
      "vertical_edge_margin_ratio" => 0.27,
      "edge_margin_ratio" => 0.11
    )
    mobile.fetch("hp").merge!(
      "bar_width_ratio" => 0.43,
      "user_text_font_size_rem" => 1.03
    )
    mobile.fetch("level").merge!(
      "offset_x_ratio" => 0.07,
      "offset_y_ratio" => 0.12,
      "user_font_size_rem" => 0.77
    )
    mobile.fetch("battle_area")["center_offset_y_ratio"] = 0.18
    mobile.fetch("cut_in")["rectangle_height_rem"] = 3.7
    mobile.fetch("cut_in").fetch("text")["font_size_rem"] = 1.9
    config = described_class.new(data)

    expect(config.css_custom_properties).to include(
      "--battle-mobile-card-gap-ratio" => 0.13,
      "--battle-mobile-vertical-edge-margin-ratio" => 0.27,
      "--battle-mobile-user-edge-margin-ratio" => 0.11,
      "--battle-mobile-hp-bar-width-ratio" => 0.43,
      "--battle-mobile-user-hp-font-size-rem" => 1.03,
      "--battle-mobile-level-offset-x-ratio" => 0.07,
      "--battle-mobile-level-offset-y-ratio" => 0.12,
      "--battle-mobile-user-level-font-size-rem" => 0.77,
      "--battle-mobile-battle-area-center-offset-y-ratio" => 0.18,
      "--battle-mobile-cut-in-rectangle-height-rem" => 3.7,
      "--battle-mobile-cut-in-text-font-size-rem" => 1.9,
      "--battle-mobile-enemy-area-center-y" => "32.0%",
      "--battle-mobile-user-area-center-y" => "68.0%"
    )
    expect(config.css_custom_properties.fetch("--battle-mobile-user-card-viewport-ratio"))
      .to be_within(0.000_001).of(1.0 / (5 + (4 * 0.13) + (2 * 0.11)))
  end

  it "ユーザーカードの5:8比率からモバイル用高さを導出する" do
    config = described_class.new(data)

    expect(config.css_custom_properties.fetch("--battle-mobile-user-card-height"))
      .to eq("#{config.css_custom_properties.fetch("--battle-mobile-user-card-viewport-ratio") * (8.0 / 5.0) * 100}vw")
  end

  it "各比率の境界を検証する" do
    invalid = Marshal.load(Marshal.dump(data))
    invalid.dig("battle_mobile", "user_hand")["card_gap_ratio"] = -0.1
    expect { described_class.new(invalid) }.to raise_error(described_class::ConfigurationError, /0以上/)

    invalid = Marshal.load(Marshal.dump(data))
    invalid.dig("battle_mobile", "user_hand")["vertical_edge_margin_ratio"] = -0.1
    expect { described_class.new(invalid) }.to raise_error(described_class::ConfigurationError, /0以上/)

    invalid = Marshal.load(Marshal.dump(data))
    invalid.dig("battle_mobile", "hp")["bar_width_ratio"] = 0
    expect { described_class.new(invalid) }.to raise_error(described_class::ConfigurationError, /0より大きい/)

    invalid = Marshal.load(Marshal.dump(data))
    invalid.dig("battle_mobile", "level")["offset_x_ratio"] = -0.1
    expect { described_class.new(invalid) }.to raise_error(described_class::ConfigurationError, /0以上/)

    invalid = Marshal.load(Marshal.dump(data))
    invalid.dig("battle_mobile", "battle_area")["center_offset_y_ratio"] = 0.5
    expect { described_class.new(invalid) }.to raise_error(described_class::ConfigurationError, /0.5未満/)

    invalid = Marshal.load(Marshal.dump(data))
    invalid.dig("battle_mobile", "cut_in")["rectangle_height_rem"] = 0
    expect { described_class.new(invalid) }.to raise_error(described_class::ConfigurationError, /0より大きい/)

    invalid = Marshal.load(Marshal.dump(data))
    invalid.dig("battle_mobile", "cut_in", "text")["font_size_rem"] = 0
    expect { described_class.new(invalid) }.to raise_error(described_class::ConfigurationError, /0より大きい/)
  end
end
