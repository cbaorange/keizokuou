require "rails_helper"

RSpec.describe "Card details", type: :system do
  def detail_text(selector)
    page.evaluate_script(
      "document.querySelector(#{selector.to_json}).textContent"
    )
  end

  def expect_detail(card_id, experience)
    card = Status.card_data(card_id)

    expect(detail_text("[data-card-detail-name]")).to eq(card.fetch("name"))
    expect(detail_text("[data-card-detail-level]")).to eq(
      Status.lv(card_id, experience).to_s
    )
    expect(detail_text("[data-card-detail-exp-to-next-level]")).to eq(
      Status.exp_to_next_level(card_id, experience).to_s
    )
    expect(detail_text("[data-card-detail-type]")).to eq(Status.type_text(card_id))
    expect(detail_text("[data-card-detail-attack]")).to eq(
      Status.atk_value(card_id, experience).to_s
    )
    expect(detail_text("[data-card-detail-defense]")).to eq(
      Status.hp_value(card_id, experience).to_s
    )
    expect(detail_text("[data-card-detail-speed]")).to eq(
      Status.spd_value(card_id).to_s
    )
    expect(detail_text("[data-card-detail-buff]")).to eq(
      Status.buff_text(
        buff: card.fetch("buff_type"),
        id: card_id,
        exp: experience,
        base: card["buff_base"].to_i,
        grow: card["buff_grow"].to_i
      )
    )
    expect(detail_text("[data-card-detail-birthplace]")).to eq(
      Status.birthplace(card_id)
    )
    expect(detail_text("[data-card-detail-exp-bonus]")).to eq(
      Status.exp_bonus_text(card_id, experience)
    )
  end

  it "switches every detail field and keeps the card on the left" do
    visit new_user_path(partner: "1")

    fill_in "ニックネーム", with: "テスト"
    fill_in "継続すること", with: "カード詳細を確認する"
    click_button "新規登録して始める"

    expect(page).to have_css(
      "[data-card-reward-modal].modal-layer:not([hidden])"
    )
    expect(page).to have_css(
      "[data-card-reward-close]:not(:disabled)",
      wait: 8
    )
    find("[data-card-reward-close]").click

    user = User.order(:id).last
    FactoryBot.create(:user_card, user: user, card_id: 4, exp: 1)
    page.execute_script(<<~JAVASCRIPT)
      localStorage.setItem("deck", JSON.stringify([1, 2, 4, 999, 0]))
    JAVASCRIPT

    visit "/cards"
    expect(page).to have_css("[data-card-detail-layer][hidden]", visible: :all)
    expect(
      page.evaluate_script('JSON.parse(localStorage.getItem("deck"))')
    ).to eq([1, 0, 4, 0, 0])
    expect(
      all(".deck-slot[data-deck-slot-index]").map do |slot|
        slot["data-syukamon-id"].to_i
      end
    ).to eq([1, 0, 4, 0, 0])

    refresh
    expect(
      page.evaluate_script('JSON.parse(localStorage.getItem("deck"))')
    ).to eq([1, 0, 4, 0, 0])

    owned_card = find('.card-placeholder[data-syukamon-id="1"]')
    unowned_card = find('.card-placeholder[data-syukamon-id="2"]')

    expect(owned_card[:class]).not_to include("card-placeholder--unowned")
    expect(owned_card).to have_css("img")
    expect(unowned_card[:class]).to include("card-placeholder--unowned")
    expect(unowned_card).to have_text("？", exact: true)
    expect(unowned_card).to have_no_css("img", visible: :all)
    expect(unowned_card).to have_no_css("button", visible: :all)
    expect(
      page.evaluate_script(<<~JAVASCRIPT)
        (() => {
          const mark = document.querySelector(".card-placeholder__unowned-mark")
          const title = document.querySelector(".app-header__page-title")

          return getComputedStyle(mark).fontSize === getComputedStyle(title).fontSize
        })()
      JAVASCRIPT
    ).to be(true)

    unowned_card.click
    expect(page).to have_css("[data-card-detail-layer][hidden]", visible: :all)

    find('button[aria-label="かぐや姫の詳細を表示"]').click

    expect(page).to have_css("[data-card-detail-layer]:not([hidden])")
    expect(page.evaluate_script("document.body.classList.contains('modal-open')")).to be(true)
    expect_detail(1, 1)

    detail_styles = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const detailLabel = document.querySelector(
          ".card-detail-dialog__detail dt"
        )
        const detailValue = document.querySelector(
          ".card-detail-dialog__detail dd"
        )
        const birthplaceRow = document.querySelector(
          "[data-card-detail-birthplace]"
        ).closest(".card-detail-dialog__detail")
        const buffRow = document.querySelector(
          "[data-card-detail-buff]"
        ).closest(".card-detail-dialog__detail")

        return {
          detailLabelFontSize: getComputedStyle(detailLabel).fontSize,
          detailValueFontSize: getComputedStyle(detailValue).fontSize,
          birthplaceWidth: birthplaceRow.getBoundingClientRect().width,
          buffWidth: buffRow.getBoundingClientRect().width
        }
      })()
    JAVASCRIPT
    expect(detail_styles.fetch("detailLabelFontSize")).to eq(
      detail_styles.fetch("detailValueFontSize")
    )
    expect(detail_styles.fetch("birthplaceWidth")).to eq(
      detail_styles.fetch("buffWidth")
    )

    positions = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const layer = document.querySelector("[data-card-detail-layer]")
        const dialog = document.querySelector(".card-detail-dialog")
        const image = document.querySelector(".card-detail-dialog__image")
        const information = document.querySelector(".card-detail-dialog__information")
        const layerRect = layer.getBoundingClientRect()

        return {
          position: getComputedStyle(layer).position,
          zIndex: getComputedStyle(layer).zIndex,
          coversViewport: layerRect.top === 0 && layerRect.left === 0 &&
            layerRect.width === document.documentElement.clientWidth &&
            layerRect.height === document.documentElement.clientHeight,
          coversHeader: document.elementFromPoint(10, 10) === layer,
          coversSidebar: document.elementFromPoint(10, 160) === layer,
          dialogIsFront: dialog.contains(
            document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
          ),
          imageLeft: image.getBoundingClientRect().left,
          informationLeft: information.getBoundingClientRect().left
        }
      })()
    JAVASCRIPT
    expect(positions).to include(
      "position" => "fixed",
      "zIndex" => "100",
      "coversViewport" => true,
      "coversHeader" => true,
      "coversSidebar" => true,
      "dialogIsFront" => true
    )
    expect(positions.fetch("imageLeft")).to be < positions.fetch("informationLeft")

    find("[data-card-detail-close]").click
    expect(page).to have_css("[data-card-detail-layer][hidden]", visible: :all)
    expect(page.evaluate_script("document.body.classList.contains('modal-open')")).to be(false)
    find('button[aria-label="ニコラ・テスラの詳細を表示"]').click

    expect_detail(4, 1)
    expect(detail_text("[data-card-detail-name]")).not_to include("かぐや姫")
    expect(detail_text("[data-card-detail-birthplace]")).not_to include("竹取物語")

    page.current_window.resize_to(390, 844)
    mobile_positions = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const image = document.querySelector(".card-detail-dialog__image")
        const information = document.querySelector(".card-detail-dialog__information")

        return {
          imageTop: image.getBoundingClientRect().top,
          informationTop: information.getBoundingClientRect().top
        }
      })()
    JAVASCRIPT
    expect(mobile_positions.fetch("imageTop")).to be < mobile_positions.fetch("informationTop")
  end
end
