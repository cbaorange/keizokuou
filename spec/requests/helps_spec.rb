require "rails_helper"

RSpec.describe "Guide", type: :request do
  before do
    reset!
  end

  describe "GET /guide" do
    it "is public and uses the dedicated layout without the app header or sidebar" do
      get guide_path

      expect(response).to have_http_status(:success)
      document = Nokogiri::HTML(response.body)

      expect(document.at_css("body.guide-layout")).to be_present
      expect(document.at_css("main.guide-main")).to be_present
      expect(document.at_css(".app-header")).to be_nil
      expect(document.at_css(".app-sidebar")).to be_nil
      expect(document.at_css("[data-battle-launcher-modal]")).to be_nil
      expect(document.at_css("h1").text.strip).to eq("継続王の使い方")
    end

    it "shows the requested sections and reuses one action partial four times" do
      get guide_path

      document = Nokogiri::HTML(response.body)
      headings = document.css(".guide-section__title").map { |heading| heading.text.strip }

      expect(headings).to eq([
        "継続王とは？",
        "習慣",
        "バトル",
        "報酬",
        "継続王が習慣化におすすめな理由",
        "データの取り扱い"
      ])
      expect(document.css(".guide-action").size).to eq(4)
      battle_section = document.at_css('[aria-labelledby="guide-battle-title"]')
      expect(battle_section.xpath("following-sibling::*[1]").first["aria-labelledby"])
        .to eq("guide-reward-title")
      expect(document.css(".guide-action__title-prefix").map(&:text).map(&:strip).uniq)
        .to eq(["最初の相棒を選んで"])
      expect(document.css(".guide-action__title-main").map(&:text).map(&:strip).uniq)
        .to eq(["継続スタート"])
      expected_guide_images = {
        "guide-habit-title" => "guides_pc/task",
        "guide-battle-title" => "guides_pc/battle",
        "guide-reward-title" => "guides_pc/reword"
      }

      expected_guide_images.each do |title_id, pc_path|
        picture = document.at_css(%([aria-labelledby="#{title_id}"] .guide-section__picture))

        expect(picture.at_css("img")["src"]).to include(pc_path)
        expect(picture.at_css("source")).to be_nil
      end
      expect(document.css(".guide-section__picture").size).to eq(3)
      expect(document.css(".guide-section__media:empty").size).to eq(3)
      expect(response.body).to include("超寄り添い、超戦う習慣化アプリ")
      expect(response.body).to include("対応デバイス：PC, スマートフォン")
      expect(response.body).to include("ニックネームやタスクの内容をアプリのサーバーに保存しません")
    end

    it "shows the five managed partners in every action for an unauthenticated user" do
      get guide_path

      document = Nokogiri::HTML(response.body)
      actions = document.css(".guide-action")
      expected_values = RegistrationChoiceCatalog::CHOICES.keys
      expected_names = RegistrationChoiceCatalog.partner_options.map { |partner| partner.fetch(:name) }

      actions.each do |action|
        partners = action.css(".guide-partner")

        expect(partners.size).to eq(5)
        expect(partners.map { |partner| partner.at_css(".guide-partner__name").text.strip })
          .to eq(expected_names)
        expect(partners.map { |partner| Rack::Utils.parse_query(URI(partner["href"]).query).fetch("partner") })
          .to eq(expected_values)
        expect(partners.map { |partner| partner.at_css("img")["src"] })
          .to all(include("/assets/portraits/"))
      end
    end

    it "shows only an app return link in every action for an authenticated user" do
      post users_path, params: {
        registration: {
          nickname: "ガイド確認",
          job: "ガイドを確認する",
          partner: "1"
        }
      }

      get guide_path

      document = Nokogiri::HTML(response.body)

      expect(response).to have_http_status(:success)
      expect(document.css(".guide-partner")).to be_empty
      expect(document.css(".guide-action__return").size).to eq(4)
      expect(document.css(".guide-action__return").map(&:text).map(&:strip).uniq)
        .to eq(["アプリに戻る"])
      expect(document.css(".guide-action__return").map { |link| link["href"] }.uniq)
        .to eq([root_path])
    end
  end

  it "redirects the old help URL to the guide" do
    get "/help"

    expect(response).to redirect_to(guide_path)
  end

  it "links the authenticated sidebar usage item to the guide" do
    post users_path, params: {
      registration: {
        nickname: "サイドバー確認",
        job: "リンクを確認する",
        partner: "1"
      }
    }

    get root_path

    document = Nokogiri::HTML(response.body)
    guide_link = document.at_css(".app-sidebar__link[href='#{guide_path}']")

    expect(guide_link).to be_present
    expect(guide_link.text.strip).to eq("使い方")
  end

  it "redirects an unauthenticated app request to the guide without a loop" do
    get root_path
    expect(response).to redirect_to(guide_path)

    follow_redirect!
    expect(response).to have_http_status(:success)
  end
end
