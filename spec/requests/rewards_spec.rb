require "rails_helper"

RSpec.describe "Rewards", type: :request do
  before do
    reset!
    post users_path, params: {
      registration: {
        nickname: "報酬確認",
        job: "報酬を確認する",
        partner: "1"
      }
    }

    User.order(:id).last.update!(display_rate: 100, internal_rate: 9_999)
  end

  it "YAMLのフォルダ設定と報酬コンテンツを表示する" do
    rewards = RewardsCatalog.load!
    get rewards_path

    expect(response).to have_http_status(:success)

    document = Nokogiri::HTML(response.body)
    page = document.at_css(".rewards-page")
    folder = document.at_css("[data-reward-folder]")
    popup = document.at_css("[data-reward-content-popup]")
    folder_config = rewards.fetch("folder")
    popup_config = rewards.fetch("content_popup_folder")
    first_content = rewards.fetch("contents").first
    unlocked_contents = rewards.fetch("contents").select do |content|
      content.fetch("required_rate") <= 100
    end
    locked_contents = rewards.fetch("contents") - unlocked_contents

    expect(document.at_css(".rewards-page__description").inner_html).to include(
      "バトルでレートを集めると、<br>報酬が解放されます"
    )
    expect(document.at_css(".rewards-page__current-rate").text.strip).to eq(
      "レート：100"
    )
    expect(response.body).not_to include("レート：9999")

    expect(page["style"]).to include(
      "--reward-folder-slope-start-ratio: #{folder_config.fetch("slope_start_ratio")}",
      "--reward-folder-tab-height-ratio: #{folder_config.fetch("tab_height_ratio")}",
      "--reward-folder-height-ratio: #{folder_config.fetch("height_ratio")}"
    )
    expect(popup["style"]).to include(
      "--reward-content-popup-slope-start-ratio: #{popup_config.fetch("slope_start_ratio")}",
      "--reward-content-popup-tab-height-ratio: #{popup_config.fetch("tab_height_ratio")}"
    )
    expect(folder.text).to include(first_content.fetch("title"))
    expect(folder.text).not_to include(first_content.fetch("body").strip)
    expect(popup.text).to include(
      first_content.fetch("title"),
      first_content.fetch("body").strip
    )
    expect(folder["aria-haspopup"]).to eq("dialog")
    expect(document.css(".reward-folder--unlocked").length).to eq(
      unlocked_contents.length
    )
    expect(document.css(".reward-folder--locked[disabled]").length).to eq(
      locked_contents.length
    )
    expect(document.css("[data-reward-content-popup]").length).to eq(
      unlocked_contents.length
    )
    expect(document.css(".reward-folder__required-rate").map { |node| node.text.strip }).to eq(
      rewards.fetch("contents").map do |content|
        "レート#{content.fetch("required_rate")}以上"
      end
    )
  end
end
