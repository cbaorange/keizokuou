require "rails_helper"

RSpec.describe "Reward unlocks", type: :system do
  def computed_style(selector, property)
    page.evaluate_script(<<~JAVASCRIPT)
      getComputedStyle(document.querySelector(#{selector.to_json}))[#{property.to_json}]
    JAVASCRIPT
  end

  it "表示レート100を境界に解放し、未解放フォルダは赤いまま開かない" do
    visit new_user_path(partner: "1")

    fill_in "ニックネーム", with: "報酬テスト"
    fill_in "継続すること", with: "報酬を確認する"
    click_button "新規登録して始める"

    expect(page).to have_css("[data-card-reward-modal]:not([hidden])")
    expect(page).to have_css(
      "[data-card-reward-close]:not(:disabled)",
      wait: 8
    )
    find("[data-card-reward-close]").click

    user = User.order(:id).last
    user.update!(display_rate: 99, internal_rate: 9_999)
    visit rewards_path

    expect(page).to have_text("レート：99")
    expect(page).to have_css(".reward-folder--locked", count: 6)
    expect(page).to have_no_css("[data-reward-content-layer]", visible: :all)

    locked_outline = find(
      ".reward-folder--locked [data-folder-shape-outline]",
      match: :first
    )
    locked_outline.hover

    expect(computed_style(
      ".reward-folder--locked [data-folder-shape-outline]",
      "stroke"
    )).to eq("rgb(208, 58, 52)")

    page.execute_script(
      'document.querySelector(".reward-folder--locked").click()'
    )
    expect(page).to have_no_css("[data-reward-content-layer]", visible: true)

    user.update!(display_rate: 100)
    refresh

    expect(page).to have_text("レート：100")
    expect(page).to have_css(".reward-folder--unlocked", count: 2)
    expect(page).to have_css(".reward-folder--locked", count: 4)
    expect(page).to have_css("[data-reward-content-layer]", count: 2, visible: :all)
    expect(computed_style(
      ".reward-folder--unlocked .reward-folder__required-rate",
      "color"
    )).to eq("rgb(119, 119, 119)")
    expect(computed_style(
      ".reward-folder--locked .reward-folder__required-rate",
      "color"
    )).to eq("rgb(208, 58, 52)")

    unlocked_folder = find(".reward-folder--unlocked", match: :first)
    unlocked_outline = unlocked_folder.find("[data-folder-shape-outline]")

    expect(computed_style(
      ".reward-folder--unlocked [data-folder-shape-outline]",
      "stroke"
    )).to eq("rgb(76, 203, 130)")

    unlocked_outline.hover

    expect(computed_style(
      ".reward-folder--unlocked [data-folder-shape-outline]",
      "stroke"
    )).to eq("rgb(42, 42, 42)")

    find(".rewards-page__current-rate").hover
    unlocked_outline.click

    expect(page).to have_css("[data-reward-content-layer]:not([hidden])")
    expect(unlocked_folder[:class]).to include("reward-folder--open")
    expect(computed_style(
      ".reward-folder--open [data-folder-shape-outline]",
      "stroke"
    )).to eq("rgb(76, 203, 130)")

    find("[data-reward-content-layer]:not([hidden])")
      .find("[data-reward-content-close]")
      .click
    expect(page).to have_no_css("[data-reward-content-layer]", visible: true)
    expect(unlocked_folder[:class]).not_to include("reward-folder--open")

    page.current_window.resize_to(320, 700)
    refresh

    height_metrics = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const folder = document.querySelector("[data-reward-folder]")
        const styles = getComputedStyle(folder)

        return {
          height: folder.getBoundingClientRect().height,
          minimumHeight: Number.parseFloat(
            styles.getPropertyValue("--reward-folder-min-height")
          )
        }
      })()
    JAVASCRIPT

    expect(height_metrics.fetch("height")).to be >
      height_metrics.fetch("minimumHeight")
  end
end
