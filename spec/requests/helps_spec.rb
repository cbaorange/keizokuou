require 'rails_helper'

RSpec.describe "Helps", type: :request do
  before do
    reset!
    post "/users", params: {
      registration: {
        job: "ヘルプを確認する",
        choice: "new_challenge"
      }
    }
  end

  describe "GET /help" do
    it "shows the help sections in order with links to each page" do
      get help_path

      expect(response).to have_http_status(:success)
      document = Nokogiri::HTML(response.body)
      sections = document.css(".help-section")

      expect(sections.map { |section| section.at_css(".help-section__title-link").text.strip }).to eq(
        %w[習慣 カード バトル 報酬]
      )
      expect(sections.map { |section| section.at_css(".help-section__number").text.strip }).to eq(
        %w[01 02 03 04]
      )
      expect(sections[0].at_css(".help-section__title-link")["href"]).to eq(tasks_path)
      expect(sections[1].at_css(".help-section__title-link")["href"]).to eq(cards_path)
      expect(sections[3].at_css(".help-section__title-link")["href"]).to eq(rewards_path)

      battle_button = sections[2].at_css("button.help-section__title-button")
      expect(battle_button["type"]).to eq("button")
      expect(battle_button.key?("data-battle-launcher-open")).to be(true)
      expect(battle_button["href"]).to be_nil
      expect(sections.map { |section| section.at_css(".help-section__description").text }).to eq(
        [
          "まずは、今日のタスクをすべて達成することから。タスクを全て達成すると、１日１枚のシュカモンカードを獲得できる。連続達成日数が長いほど、シュカモンが育ちやすくなる。",
          "集めたシュカモンを確認して、自分だけのデッキを編成。カードが足りなくても、バトルではレンタルシュカモンを借りられる。",
          "育てたシュカモンを率いて、シュカモンバトルに挑戦！勝利を重ねれば、報酬につながるレートを獲得できる。",
          "集めたレートで、習慣化に役立つ新しい知識を学ぶ。習慣を挫折しにくくする工夫や、集中しやすい環境の作り方など、「知っているだけで習慣を続けやすくなる」実践的な情報を確認できる。"
        ]
      )

      help_link = document.at_css(".app-sidebar__link[href='#{help_path}']")
      expect(help_link.text.strip).to eq("使い方")
      expect(help_link["class"].split).to include("app-sidebar__link--current")
      expect(help_link["aria-current"]).to eq("page")
    end

    it "does not expose the generated route" do
      expect {
        Rails.application.routes.recognize_path("/helps/show", method: :get)
      }.to raise_error(ActionController::RoutingError)
    end
  end
end
