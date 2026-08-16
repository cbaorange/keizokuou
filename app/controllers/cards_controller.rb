class CardsController < ApplicationController
  def index
    experience_by_card_id = current_user.user_cards.pluck(:card_id, :exp).to_h

    @syukamon_cards = Status.syukamon_data.values.filter_map do |configured_card|
      card_id = configured_card.fetch("id").to_i
      card = Status.card_data(card_id)
      next if card.nil?

      owned = experience_by_card_id.key?(card_id)
      card_view = { id: card_id, owned: owned }
      next card_view unless owned

      experience = experience_by_card_id.fetch(card_id)

      card_view.merge(
        name: card.fetch("name"),
        short_name: card.fetch("short_name"),
        image_tag_cards: card.fetch("image_tag_cards"),
        image_tag_portraits: card.fetch("image_tag_portraits"),
        detail: {
          level: Status.lv(card_id, experience),
          exp_to_next_level: Status.exp_to_next_level(card_id, experience),
          type: Status.type_text(card_id),
          attack: Status.atk_value(card_id, experience),
          defense: Status.hp_value(card_id, experience),
          speed: Status.spd_value(card_id),
          buff: Status.buff_text(
            buff: card.fetch("buff_type"),
            id: card_id,
            exp: experience,
            base: card["buff_base"].to_i,
            grow: card["buff_grow"].to_i
          ),
          birthplace: Status.birthplace(card_id),
          exp_bonus: Status.exp_bonus_text(card_id, experience)
        }
      )
    end

    @owned_card_ids = @syukamon_cards.filter_map do |syukamon|
      syukamon.fetch(:id) if syukamon.fetch(:owned)
    end
  end
end
