require 'rails_helper'

RSpec.describe "Cards", type: :request do
  before do
    reset!
  end

  describe "GET /cards" do
    before do
      post "/users", params: {
        registration: {
          nickname: "カード確認",
          job: "毎日カードを確認する",
          partner: "1"
        }
      }
    end

    it "returns http success" do
      get "/cards"

      expect(response).to have_http_status(:success)
    end

    it "passes every card detail through the existing Status methods" do
      status_methods = %i[
        card_data
        lv
        exp_to_next_level
        type_text
        atk_value
        hp_value
        spd_value
        buff_text
        birthplace
        exp_bonus_text
      ]
      status_methods.each do |method_name|
        allow(Status).to receive(method_name).and_call_original
      end

      get "/cards"

      document = Nokogiri::HTML(response.body)
      cards = document.css(".card-placeholder[data-syukamon-id]")
      cards_page = document.at_css(".cards-page[data-owned-card-ids]")
      initial_card = cards.find { |card| card["data-syukamon-id"] == "1" }
      unowned_card = cards.find { |card| card["data-syukamon-id"] == "2" }

      status_methods.each do |method_name|
        expect(Status).to have_received(method_name).at_least(:once)
      end

      expect(cards.size).to eq(Status.syukamon_data.size)
      expect(JSON.parse(cards_page["data-owned-card-ids"])).to eq([1])
      expect(initial_card["data-card-owned"]).to eq("true")
      expect(initial_card["data-syukamon-name"]).to eq(
        Status.card_data(1).fetch("name")
      )
      expect(initial_card["data-syukamon-detail-level"]).to eq(Status.lv(1, 1).to_s)
      expect(initial_card["data-syukamon-detail-exp-to-next-level"]).to eq(
        Status.exp_to_next_level(1, 1).to_s
      )
      expect(initial_card["data-syukamon-detail-type"]).to eq(Status.type_text(1))
      expect(initial_card["data-syukamon-detail-attack"]).to eq(Status.atk_value(1, 1).to_s)
      expect(initial_card["data-syukamon-detail-defense"]).to eq(Status.hp_value(1, 1).to_s)
      expect(initial_card["data-syukamon-detail-speed"]).to eq(Status.spd_value(1).to_s)
      expect(initial_card["data-syukamon-detail-birthplace"]).to eq(Status.birthplace(1))
      expect(initial_card["data-syukamon-detail-exp-bonus"]).to eq(
        Status.exp_bonus_text(1, 1)
      )
      expect(unowned_card["data-card-owned"]).to eq("false")
      expect(unowned_card.classes).to include("card-placeholder--unowned")
      expect(unowned_card.text.strip).to eq("？")
      expect(unowned_card.at_css("img")).to be_nil
      expect(unowned_card.at_css("[data-deck-add-button]")).to be_nil
      expect(unowned_card.at_css("[data-card-detail-button]")).to be_nil
      expect(unowned_card["data-syukamon-name"]).to be_nil
    end
  end
end
