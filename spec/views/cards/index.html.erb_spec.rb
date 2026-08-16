require 'rails_helper'

RSpec.describe "cards/index", type: :view do
  let(:syukamon_cards) do
    [
      {
        id: 1,
        owned: true,
        name: "かぐや姫",
        short_name: "かぐや姫",
        image_tag_cards: "cards/kaguya.PNG",
        image_tag_portraits: "portraits/kaguya.PNG",
        detail: {
          level: 1,
          exp_to_next_level: 19,
          type: "月",
          attack: 50,
          defense: 150,
          speed: 96,
          buff: "速さが上がる",
          birthplace: "竹取物語",
          exp_bonus: "月曜日に経験値ボーナス"
        }
      },
      {
        id: 2,
        owned: false
      }
    ]
  end

  before do
    assign(:syukamon_cards, syukamon_cards)
    assign(:owned_card_ids, [1])
  end

  it "renders five deck slots, cards, and every detail field" do
    render

    document = Nokogiri::HTML.fragment(rendered)

    expect(document.css(".deck-slot").size).to eq(5)
    expect(document.css(".card-placeholder").size).to eq(2)
    expect(document.css("[data-deck-add-button]").size).to eq(1)
    expect(document.css("[data-card-detail-button]").size).to eq(1)
    expect(
      document.css("[data-syukamon-short-name]").map { |card| card["data-syukamon-short-name"] }
    ).to eq(["かぐや姫"])
    expect(document.css("[data-deck-remove-button][hidden]").size).to eq(5)
    expect(document.at_css("[data-card-detail-layer][hidden]")).to be_present
    expect(document.at_css("[data-card-detail-layer].modal-layer")).to be_present
    expect(document.at_css("[data-deck-full-warning][hidden]")).to be_present
    expect(document.at_css(".cards-page")["data-owned-card-ids"]).to eq("[1]")
    unowned_card = document.at_css(
      '.card-placeholder--unowned[data-syukamon-id="2"]'
    )
    expect(unowned_card["aria-label"]).to eq("未所持カード")
    expect(unowned_card["tabindex"]).to be_nil
    expect(unowned_card.text.strip).to eq("？")
    expect(unowned_card.at_css("img")).to be_nil
    expect(unowned_card.at_css("button")).to be_nil
    expect(document.at_css("[data-card-detail-name]")).to be_present
    expect(document.at_css("[data-card-detail-level]")).to be_present
    expect(document.at_css("[data-card-detail-exp-to-next-level]")).to be_present
    expect(document.at_css("[data-card-detail-type]")).to be_present
    expect(document.at_css("[data-card-detail-attack]")).to be_present
    expect(document.at_css("[data-card-detail-defense]")).to be_present
    expect(document.at_css("[data-card-detail-speed]")).to be_present
    expect(document.at_css("[data-card-detail-buff]")).to be_present
    expect(document.at_css("[data-card-detail-birthplace]")).to be_present
    expect(document.at_css("[data-card-detail-exp-bonus]")).to be_present
    expect(
      document.at_css("[data-card-detail-birthplace]").parent["class"]
    ).to include("card-detail-dialog__detail--description")
    detail_rows = document.css(".card-detail-dialog__detail")
    expect(detail_rows.first(6).map { |row| row.at_css("dt").text }).to eq(
      ["レベル", "次のレベルまで", "タイプ", "体力", "攻撃", "速さ"]
    )
    detail_body_children = document.at_css(
      ".card-detail-dialog__body"
    ).element_children
    expect(detail_body_children.first["class"]).to include(
      "card-detail-dialog__image"
    )
    expect(detail_body_children[1]["class"]).to include(
      "card-detail-dialog__information"
    )
    expect(rendered).to include("デッキ")
    expect(rendered).not_to include("仮ステータス")
    expect(rendered).not_to include('id="card-catalog-heading"')
  end

  it "uses existing variables for the unowned card appearance" do
    stylesheet = Rails.root.join(
      "app/assets/stylesheets/cards/_index.scss"
    ).read

    expect(stylesheet).to include("background: var(--color-text-disabled);")
    expect(stylesheet).to include("font-size: var(--font-size-header);")
    expect(stylesheet.scan("font-size: var(--font-size-body);").size).to be >= 2
  end
end
