class BattleMobileConfig
  class ConfigurationError < StandardError; end

  attr_reader :data

  def initialize(data)
    @data = require_hash(data, "battle_mobile.yml")
    validate!
  end

  def css_custom_properties
    mobile = data.fetch("battle_mobile")
    user_hand = mobile.fetch("user_hand")
    hp = mobile.fetch("hp")
    level = mobile.fetch("level")
    battle_area = mobile.fetch("battle_area")
    cut_in = mobile.fetch("cut_in")
    cut_in_text = cut_in.fetch("text")
    footprint_ratio = 5 + (4 * user_hand.fetch("card_gap_ratio")) +
      (2 * user_hand.fetch("edge_margin_ratio"))
    user_card_viewport_ratio = 1.0 / footprint_ratio
    center_offset_y_ratio = battle_area.fetch("center_offset_y_ratio")

    {
      "--battle-mobile-card-gap-ratio" => user_hand.fetch("card_gap_ratio"),
      "--battle-mobile-vertical-edge-margin-ratio" => user_hand.fetch("vertical_edge_margin_ratio"),
      "--battle-mobile-user-edge-margin-ratio" => user_hand.fetch("edge_margin_ratio"),
      "--battle-mobile-hp-bar-width-ratio" => hp.fetch("bar_width_ratio"),
      "--battle-mobile-user-hp-font-size-rem" => hp.fetch("user_text_font_size_rem"),
      "--battle-mobile-level-offset-x-ratio" => level.fetch("offset_x_ratio"),
      "--battle-mobile-level-offset-y-ratio" => level.fetch("offset_y_ratio"),
      "--battle-mobile-user-level-font-size-rem" => level.fetch("user_font_size_rem"),
      "--battle-mobile-battle-area-center-offset-y-ratio" => center_offset_y_ratio,
      "--battle-mobile-cut-in-rectangle-height-rem" => cut_in.fetch("rectangle_height_rem"),
      "--battle-mobile-cut-in-text-font-size-rem" => cut_in_text.fetch("font_size_rem"),
      "--battle-mobile-user-card-viewport-ratio" => user_card_viewport_ratio,
      "--battle-mobile-user-card-width" => "#{user_card_viewport_ratio * 100}vw",
      "--battle-mobile-user-card-height" => "#{user_card_viewport_ratio * (8.0 / 5.0) * 100}vw",
      "--battle-mobile-card-gap" => "#{user_card_viewport_ratio * user_hand.fetch("card_gap_ratio") * 100}vw",
      "--battle-mobile-user-edge-margin" => "#{user_card_viewport_ratio * user_hand.fetch("edge_margin_ratio") * 100}vw",
      "--battle-mobile-vertical-edge-margin" => "#{user_card_viewport_ratio * user_hand.fetch("vertical_edge_margin_ratio") * 100}vw",
      "--battle-mobile-hp-bar-width" => "#{hp.fetch("bar_width_ratio") * 100}%",
      "--battle-mobile-user-hp-font-size" => "#{hp.fetch("user_text_font_size_rem")}rem",
      "--battle-mobile-level-offset-x-percent" => "#{level.fetch("offset_x_ratio") * 100}%",
      "--battle-mobile-level-offset-y-percent" => "#{level.fetch("offset_y_ratio") * (5.0 / 8.0) * 100}%",
      "--battle-mobile-user-level-font-size" => "#{level.fetch("user_font_size_rem")}rem",
      "--battle-mobile-enemy-area-center-y" => "#{(0.5 - center_offset_y_ratio) * 100}%",
      "--battle-mobile-user-area-center-y" => "#{(0.5 + center_offset_y_ratio) * 100}%",
      "--battle-mobile-cut-in-rectangle-height" => "#{cut_in.fetch("rectangle_height_rem")}rem",
      "--battle-mobile-cut-in-text-font-size" => "#{cut_in_text.fetch("font_size_rem")}rem"
    }
  end

  private

  def validate!
    mobile = require_hash(data["battle_mobile"], "battle_mobile")
    user_hand = require_hash(mobile["user_hand"], "battle_mobile.user_hand")
    hp = require_hash(mobile["hp"], "battle_mobile.hp")
    level = require_hash(mobile["level"], "battle_mobile.level")
    battle_area = require_hash(mobile["battle_area"], "battle_mobile.battle_area")
    cut_in = require_hash(mobile["cut_in"], "battle_mobile.cut_in")
    cut_in_text = require_hash(cut_in["text"], "battle_mobile.cut_in.text")

    require_number(user_hand["card_gap_ratio"], "battle_mobile.user_hand.card_gap_ratio", minimum: 0)
    require_number(user_hand["vertical_edge_margin_ratio"], "battle_mobile.user_hand.vertical_edge_margin_ratio", minimum: 0)
    require_number(user_hand["edge_margin_ratio"], "battle_mobile.user_hand.edge_margin_ratio", minimum: 0)
    require_positive(hp["bar_width_ratio"], "battle_mobile.hp.bar_width_ratio")
    require_positive(hp["user_text_font_size_rem"], "battle_mobile.hp.user_text_font_size_rem")
    require_number(level["offset_x_ratio"], "battle_mobile.level.offset_x_ratio", minimum: 0)
    require_number(level["offset_y_ratio"], "battle_mobile.level.offset_y_ratio", minimum: 0)
    require_positive(level["user_font_size_rem"], "battle_mobile.level.user_font_size_rem")
    require_number(
      battle_area["center_offset_y_ratio"],
      "battle_mobile.battle_area.center_offset_y_ratio",
      minimum: 0,
      maximum_exclusive: 0.5
    )
    require_positive(cut_in["rectangle_height_rem"], "battle_mobile.cut_in.rectangle_height_rem")
    require_positive(cut_in_text["font_size_rem"], "battle_mobile.cut_in.text.font_size_rem")
  end

  def require_hash(value, path)
    return value if value.is_a?(Hash)

    raise ConfigurationError, "#{path}はHashである必要があります"
  end

  def require_number(value, path, minimum: nil, maximum: nil, maximum_exclusive: nil)
    unless value.is_a?(Numeric) && value.finite?
      raise ConfigurationError, "#{path}は有限数である必要があります"
    end
    if !minimum.nil? && value < minimum
      raise ConfigurationError, "#{path}は#{minimum}以上である必要があります"
    end
    if !maximum.nil? && value > maximum
      raise ConfigurationError, "#{path}は#{maximum}以下である必要があります"
    end
    if !maximum_exclusive.nil? && value >= maximum_exclusive
      raise ConfigurationError, "#{path}は#{maximum_exclusive}未満である必要があります"
    end

    value
  end

  def require_positive(value, path)
    require_number(value, path)
    raise ConfigurationError, "#{path}は0より大きい必要があります" unless value.positive?

    value
  end
end
