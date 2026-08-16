module ApplicationHelper
  def battle_launcher_bootstrap_data(user)
    owned_card_ids = user.user_cards.order(:card_id).pluck(:card_id)
    owned_card_id_set = owned_card_ids.index_with(true)
    portrait_cards = Status.syukamon_data.values.each_with_object({}) do |card_data, cards|
      card_id = card_data.fetch("id")
      next unless owned_card_id_set.key?(card_id)

      cards[card_id.to_s] = {
        "name" => card_data.fetch("name"),
        "portraitUrl" => asset_path(card_data.fetch("image_tag_portraits"))
      }
    end

    {
      "displayRate" => BattleRateValue.normalize!(user.display_rate, "表示レート"),
      "ownedCardIds" => owned_card_ids,
      "portraitCards" => portrait_cards
    }
  end
end
