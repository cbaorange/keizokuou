class BattlesController < ApplicationController
  layout 'battle'

  def show
    syukamon_data = load_battle_yaml("syukamon.yml")
    battle_config = load_battle_yaml("battle.yml")
    battle_rules = BattleRules.new(battle_config)
    mobile_config = BattleMobileConfig.new(load_battle_yaml("battle_mobile.yml"))
    creation = BattleSessionCreator.new(
      user: current_user,
      battle_rules: battle_rules
    ).call
    battle_session = creation.battle_session

    @battle_bootstrap_data = {
      "ownedCards" => current_user.user_cards.order(:card_id).pluck(:card_id, :exp).map do |card_id, exp|
        { "cardId" => card_id, "exp" => exp }
      end,
      "rates" => {
        "displayRate" => battle_session.display_rate_before_battle,
        "internalRate" => creation.internal_rate
      },
      "battleSession" => {
        "token" => battle_session.token,
        "difficulty" => battle_session.difficulty,
        "displayRateBeforeBattle" => battle_session.display_rate_before_battle,
        "displayRateWinBonus" => battle_session.display_rate_win_bonus
      },
      "config" => {
        "syukamon" => syukamon_data,
        "battle" => battle_config,
        "animations" => load_battle_yaml("battle_animations.yml"),
        "effects" => load_battle_yaml("battle_effects.yml"),
        "mobile" => mobile_config.data
      },
      "assets" => {
        "cardBackUrl" => helpers.asset_path("cards/card_back.PNG"),
        "cardImageUrls" => resolved_syukamon_asset_urls(syukamon_data, "image_tag_cards"),
        "rentalCardImageUrls" => resolved_rental_card_asset_urls(syukamon_data),
        "portraitImageUrls" => resolved_syukamon_asset_urls(syukamon_data, "image_tag_portraits")
      }
    }
    @battle_css_custom_properties = battle_css_custom_properties(battle_rules)
    @battle_mobile_css_custom_properties = mobile_config.css_custom_properties
  end

  def debug
    @battle_css_custom_properties = battle_css_custom_properties(
      BattleRules.new(load_battle_yaml("battle.yml"))
    )
    @battle_mobile_css_custom_properties = BattleMobileConfig
      .new(load_battle_yaml("battle_mobile.yml"))
      .css_custom_properties
  end

  private

  def load_battle_yaml(file_name)
    YAML.safe_load_file(Rails.root.join("config", "data", file_name))
  end

  def battle_css_custom_properties(battle_rules)
    {
      "--battle-area-card-padding" => "#{battle_rules.battle_area_card_padding_px}px",
      "--battle-area-border-radius-ratio" => battle_rules.battle_area_border_radius_ratio
    }
  end

  def resolved_syukamon_asset_urls(syukamon_data, asset_key)
    syukamon_data.each_with_object({}) do |(_name, card_data), urls|
      card_id = card_data.fetch("id")
      urls[card_id.to_s] = helpers.asset_path(card_data.fetch(asset_key))
    end
  end

  def resolved_rental_card_asset_urls(syukamon_data)
    syukamon_data.each_with_object({}) do |(syukamon_key, card_data), urls|
      asset_path = "rental_cards/#{syukamon_key}.PNG"
      next unless Rails.root.join("app", "assets", "images", asset_path).file?

      urls[card_data.fetch("id").to_s] = helpers.asset_path(asset_path)
    end
  end
end
