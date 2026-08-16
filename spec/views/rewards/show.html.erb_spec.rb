require "rails_helper"

RSpec.describe "rewards/show", type: :view do
  it "表示レート100を境界に一覧を解放し、未解放本文を描画しない" do
    contents = [99, 100, 101].map.with_index do |required_rate, index|
      {
        "title" => "サンプル報酬#{index}",
        "body" => "サンプル本文#{index}",
        "required_rate" => required_rate
      }
    end
    assign(:display_rate, 100)
    assign(:rewards, {
      "folder" => {
        "slope_start_ratio" => 0.37,
        "tab_height_ratio" => 0.09,
        "height_ratio" => 0.55
      },
      "content_popup_folder" => {
        "slope_start_ratio" => 0.41,
        "tab_height_ratio" => 0.07
      },
      "contents" => contents
    })

    render

    expect(rendered).to have_css(".rewards-page__folders > button.reward-folder", count: 3)
    expect(rendered).to have_css(".reward-folder--unlocked", count: 2)
    expect(rendered).to have_css(".reward-folder--locked[disabled]", count: 1)
    expect(rendered).to have_css("[data-reward-content-layer][hidden]", count: 2, visible: :all)
    expect(rendered).to have_css("[data-reward-content-popup]", count: 2, visible: :all)
    expect(rendered).to have_css(".reward-folder__required-rate", count: 3)
    expect(rendered).to have_css(".rewards-page__current-rate", text: "レート：100")
    expect(rendered).to include("バトルでレートを集めると、<br>報酬が解放されます")

    contents.each_with_index do |content, index|
      fragment = Nokogiri::HTML.fragment(rendered)
      folder = fragment.at_css("[data-reward-folder]:nth-of-type(#{index + 1})")
      popup = fragment.at_css("#reward-content-popup-#{index}")

      expect(folder.text).to include(
        content.fetch("title"),
        "レート#{content.fetch("required_rate")}以上"
      )
      expect(folder.text).not_to include(content.fetch("body"))

      if content.fetch("required_rate") <= 100
        expect(popup.text).to include(content.fetch("title"), content.fetch("body"))
      else
        expect(popup).to be_nil
      end
    end

    expect(rendered).to include(
      "--reward-folder-slope-start-ratio: 0.37",
      "--reward-folder-height-ratio: 0.55",
      "--reward-content-popup-slope-start-ratio: 0.41"
    )
    expect(rendered).not_to include("--reward-content-popup-height")
  end
end
