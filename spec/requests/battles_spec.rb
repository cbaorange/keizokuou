require "rails_helper"

RSpec.describe "Battles", type: :request do
  before do
    reset!
    allow_any_instance_of(ActionView::Base).to receive(:stylesheet_link_tag).and_return("")
    allow_any_instance_of(ActionView::Base).to receive(:compute_asset_path) do |_view, source, *_options|
      "/assets/#{source}"
    end
    allow_any_instance_of(ActionView::Base).to receive(:javascript_include_tag) do |_view, source, *_options|
      %(<script src="/assets/#{source}.js"></script>).html_safe
    end
    asset_helpers = double("battle asset helpers")
    allow(asset_helpers).to receive(:asset_path) do |path|
      "/assets/#{path}"
    end
    allow_any_instance_of(BattlesController).to receive(:helpers).and_return(asset_helpers)
  end

  def authentication_cookie_for(user)
    raw_token = user.issue_authentication_token!
    encrypted_cookie_jar = ActionDispatch::Request.new(
      Rails.application.env_config.dup
    ).cookie_jar

    encrypted_cookie_jar.encrypted[
      ApplicationController::AUTHENTICATION_COOKIE_NAME
    ] = {
      value: { user_id: user.id, raw_token: raw_token },
      expires: 1.year.from_now,
      httponly: true,
      same_site: :lax,
      secure: false,
      path: "/"
    }

    encrypted_cookie_jar.to_header
  end

  def get_as(user, path)
    get path, headers: { "Cookie" => authentication_cookie_for(user) }
  end

  def bootstrap_data
    document = Nokogiri::HTML(response.body)
    JSON.parse(document.at_css("#battle-bootstrap-data").text)
  end

  def stub_battle_mobile_config
    path = Rails.root.join("config/data/battle_mobile.yml")
    data = YAML.safe_load_file(path)
    mobile = data.fetch("battle_mobile")
    mobile.fetch("user_hand").merge!(
      "card_gap_ratio" => 0.13,
      "vertical_edge_margin_ratio" => 0.27,
      "edge_margin_ratio" => 0.11
    )
    mobile.fetch("hp").merge!(
      "bar_width_ratio" => 0.43,
      "user_text_font_size_rem" => 1.03
    )
    mobile.fetch("cut_in")["rectangle_height_rem"] = 3.7
    mobile.fetch("cut_in").fetch("text")["font_size_rem"] = 1.9
    allow(YAML).to receive(:safe_load_file).and_call_original
    allow(YAML).to receive(:safe_load_file).with(path).and_return(data)

    data
  end

  def expect_battle_mobile_css(document, data)
    style = document.at_css(".battle")["style"]

    BattleMobileConfig.new(data).css_custom_properties.each do |name, value|
      expect(style).to include("#{name}: #{value};")
    end
  end

  describe "GET /battle" do
    it "所有カードEXP、nilを0にしたレート、5種YAML、アセットURLを渡す" do
      user = FactoryBot.create(:user, display_rate: nil, internal_rate: nil)
      FactoryBot.create(:user_card, user: user, card_id: 1, exp: 20)

      expect { get_as(user, "/battle") }
        .to change(BattleSession, :count).by(1)

      expect(response).to have_http_status(:success)
      data = bootstrap_data
      session = user.battle_sessions.order(:id).last
      expect(data.fetch("ownedCards")).to eq([{ "cardId" => 1, "exp" => 20 }])
      expect(data.fetch("rates")).to eq({ "displayRate" => 0, "internalRate" => 0 })
      expect(data.fetch("battleSession")).to eq(
        "token" => session.token,
        "difficulty" => session.difficulty,
        "displayRateBeforeBattle" => 0,
        "displayRateWinBonus" => session.display_rate_win_bonus
      )
      expect(session.display_rate_win_bonus).to be_between(0, 100)
      expect(session).not_to be_completed
      expect(user.reload.internal_rate).to eq(0)
      expect(user.display_rate).to be_nil
      expect(data.dig("config", "syukamon")).to eq(YAML.safe_load_file(Rails.root.join("config/data/syukamon.yml")))
      expect(data.dig("config", "battle")).to eq(YAML.safe_load_file(Rails.root.join("config/data/battle.yml")))
      expect(data.dig("config", "animations")).to eq(YAML.safe_load_file(Rails.root.join("config/data/battle_animations.yml")))
      expect(data.dig("config", "effects")).to eq(YAML.safe_load_file(Rails.root.join("config/data/battle_effects.yml")))
      expect(data.dig("config", "mobile")).to eq(YAML.safe_load_file(Rails.root.join("config/data/battle_mobile.yml")))
      expect(data.dig("config", "animations", "attack_wait", "first", "duration_ms")).to eq(900)
      expect(data.dig("config", "animations", "pre_battle_exit", "duration_ms")).to eq(700)
      expect(data.dig("config", "battle", "result", "card_width_ratio")).to eq(1.2)
      expect(data.dig("assets", "cardBackUrl")).to include("/assets/cards/card_back")
      expect(data.dig("assets", "cardImageUrls", "1")).to include("/assets/cards/kaguya")
      expect(data.dig("assets", "cardImageUrls", "3")).to include("/assets/cards/suibo")
      expect(data.dig("assets", "rentalCardImageUrls", "3")).to include("/assets/rental_cards/suibo")
      expect(data.dig("assets", "portraitImageUrls", "1")).to include("/assets/portraits/kaguya")
      expect(data.dig("assets", "portraitImageUrls", "3")).to include("/assets/portraits/suibo")
    end

    it "保存済みレートと本番用10スロットDOMを渡し、battle_flowだけをページ固有読込する" do
      user = FactoryBot.create(:user, display_rate: 25, internal_rate: 80)

      get_as(user, "/battle")

      expect(response).to have_http_status(:success)
      expect(bootstrap_data.fetch("rates")).to eq({ "displayRate" => 25, "internalRate" => 30 })
      session = user.battle_sessions.order(:id).last
      expect(bootstrap_data.dig("battleSession", "difficulty")).to eq(session.difficulty)
      document = Nokogiri::HTML(response.body)
      expect(document.css('.battle__hand--user > .battle__hand-row > .battle__hand-card[data-team="user"][data-slot]').map { |node| node["data-slot"] }).to eq(%w[A B C D E])
      expect(document.css('.battle__hand--enemy > .battle__hand-row > .battle__hand-card[data-team="enemy"][data-slot]').map { |node| node["data-slot"] }).to eq(%w[Z Y X W V])
      expect(document.css('.battle__status-list--right [data-team="user"][data-slot]').size).to eq(5)
      expect(document.css('.battle__status-list--left [data-team="enemy"][data-slot]').size).to eq(5)
      expect(document.css('.battle__center-panel[data-team="user"]').size).to eq(1)
      expect(document.css('.battle__center-panel[data-team="enemy"]').size).to eq(1)
      expect(document.css('[data-battle-status-anchor][data-team="user"]').size).to eq(1)
      expect(document.css('[data-battle-status-anchor][data-team="enemy"]').size).to eq(1)
      expect(document.css('[data-battle-entry-cover]').size).to eq(1)
      expect(document.css('[data-role="current-spd"]')).to be_empty
      expect(document.css('[data-role="current-hp"]').size).to eq(10)
      expect(document.css('[data-role="max-hp"]').size).to eq(10)
      expect(document.css('[data-role="level"]').size).to eq(10)
      expect(document.css('[data-battle-mobile-hud]').size).to eq(10)
      expect(document.css('[data-role="mobile-level"]').size).to eq(10)
      expect(document.css('[data-role="mobile-current-hp"]').size).to eq(10)
      expect(document.css('.battle__status-metrics').size).to eq(10)
      expect(document.css('.battle__blind').size).to eq(0)
      expect(document.css('.battle > [data-battle-animation-choice-dim]').size).to eq(1)
      expect(document.css('.battle > [data-battle-animation-choice-prompt]').text).to include("Choose Your Cards")
      expect(document.css('[data-battle-surrender-open]').text.strip).to eq("降参")
      expect(document.css('[data-battle-surrender-layer]').size).to eq(1)
      expect(document.css('[data-battle-surrender-cancel]').text.strip).to eq("あきらめない")
      expect(document.css('[data-battle-surrender-confirm]').text.strip).to eq("降参")
      expect(document.css('.battle > [data-battle-animation-start-message]').size).to eq(1)
      expect(document.css('[data-battle-defeat-effect-layer][data-team="user"]').size).to eq(1)
      expect(document.css('[data-battle-defeat-effect-layer][data-team="enemy"]').size).to eq(1)
      expect(document.css('.battle__hand-card > [data-battle-animation-position] > [data-battle-animation-size] > [data-battle-animation-orientation] > [data-battle-animation-flip] > [data-battle-animation-selection] > [data-battle-animation-attack]').size).to eq(10)
      expect(document.css('.battle__hand-card [data-battle-animation-shadow]').size).to eq(10)
      expect(document.css('.battle__hand-card [data-battle-animation-motion]').size).to eq(10)
      expect(document.css('.battle__hand-card [data-battle-effect-layer]').size).to eq(10)
      expect(document.css('[data-battle-effect-action]').size).to eq(0)
      expect(document.css('[data-battle-animation-action]').size).to eq(0)
      page_scripts = document.css("script[src]").map { |node| node["src"] }
      expect(page_scripts.count { |source| source.include?("battle_flow") }).to eq(1)
      expect(page_scripts.none? { |source| source.include?("battle_engine") }).to be(true)
      expect(page_scripts.none? { |source| source.include?("battle_cpu_ai") }).to be(true)
    end

    it "開始変動後レートで即時戦闘画面を返し、結果画面は新しいbattleへの再戦リンクを持つ" do
      mobile_config = stub_battle_mobile_config
      user = FactoryBot.create(:user, display_rate: 25, internal_rate: 2_000)

      expect { get_as(user, "/battle") }
        .to change(BattleSession, :count).by(1)

      expect(response).to have_http_status(:success)
      document = Nokogiri::HTML(response.body)
      result_screen = document.at_css("[data-battle-result-screen]")
      preparation_error_screen = document.at_css("[data-battle-preparation-error-screen]")

      expect(document.at_css("[data-battle-pre-screen]")).to be_nil
      battle_screen = document.at_css(".battle")
      expect(battle_screen["class"].split).to include("battle--cards-awaiting-entry")
      expect(battle_screen["style"]).to include("--battle-card-entry-user-start-y: 120.0%")
      expect(battle_screen["style"]).to include("--battle-card-entry-enemy-start-y: -120.0%")
      expect(battle_screen["style"]).to include("--battle-area-card-padding: 7px")
      expect(battle_screen["style"]).to include("--battle-area-border-radius-ratio: 0.08")
      expect_battle_mobile_css(document, mobile_config)
      expect(result_screen).to be_present
      expect(result_screen.key?("hidden")).to be(true)
      expect(result_screen["data-tasks-url"]).to eq(cards_path)
      expect(result_screen["data-rematch-url"]).to eq(battle_path)
      expect(preparation_error_screen).to be_present
      expect(preparation_error_screen.key?("hidden")).to be(true)
      expect(preparation_error_screen.at_css("[data-battle-preparation-error-return]")["href"]).to eq(tasks_path)
      expect(preparation_error_screen.text).to include("原因不明のエラーが発生しました。")
      expect(preparation_error_screen.text).to include("お手数ですが、アプリ制作者にご連絡ください。")
      expect(user.reload.internal_rate).to eq(1_950)
      expect(user.display_rate).to eq(25)
    end

    it "GETするたびに開始変動と新しいBattleSessionを適用する" do
      user = FactoryBot.create(:user, display_rate: 25, internal_rate: 2_000)
      tokens = []

      3.times do
        expect { get_as(user, "/battle") }
          .to change(BattleSession, :count).by(1)
        tokens << user.battle_sessions.order(:id).last.token
      end

      expect(tokens.uniq.size).to eq(3)
      expect(user.reload.internal_rate).to eq(1_850)
      expect(bootstrap_data.dig("rates", "internalRate")).to eq(1_850)
    end

    it "負数レートを無言で0へ変換しない" do
      user = FactoryBot.create(:user, display_rate: -1, internal_rate: 0)

      expect { get_as(user, "/battle") }
        .not_to change(BattleSession, :count)

      expect(response).to have_http_status(:internal_server_error)
      expect(response.body).to include("表示レートは0以上の整数である必要があります")
      expect(user.reload.internal_rate).to eq(0)
    end
  end

  describe "GET /battle/debug" do
    it "id3のsuiboカードと通常ポートレートを現在のYAML定義から描画する" do
      user = FactoryBot.create(:user)

      get_as(user, "/battle/debug")

      expect(response).to have_http_status(:success)
      document = Nokogiri::HTML(response.body)
      expect(document.css('.battle__hand-card-image').map { |node| node["src"] }.compact)
        .to include("/assets/cards/suibo.PNG")
      expect(document.css('[data-role="portrait"]').map { |node| node["src"] }.compact)
        .to include("/assets/portraits/suibo.PNG")
      expect(document.css('[data-role="card-name"]').map { |node| node.text.strip })
        .to include("水母娘娘")
    end

    it "既存のエフェクト・モーションUIと5枚ずつの手札を維持する" do
      mobile_config = stub_battle_mobile_config
      user = FactoryBot.create(:user)

      expect { get_as(user, "/battle/debug") }
        .not_to change(BattleSession, :count)

      expect(response).to have_http_status(:success)
      document = Nokogiri::HTML(response.body)
      expect(document.css('[data-battle-effect-action="hit-user"]').size).to eq(1)
      expect(document.css("[data-battle-cut-in-action]").size).to eq(6)
      cut_in_debug_data = JSON.parse(document.at_css("#battle-cut-in-debug-data").text)
      expect(cut_in_debug_data.fetch("portraitUrl")).to include("/assets/portraits/")
      expect(cut_in_debug_data.fetch("normalDefeat")).to be_present
      expect(cut_in_debug_data.fetch("finalDefeat")).to be_present
      expect(document.css('[data-battle-animation-action="turn"]').size).to eq(1)
      expect(document.css('.battle__hand--user .battle__hand-card').size).to eq(5)
      expect(document.css('.battle__hand--enemy .battle__hand-card').size).to eq(5)
      expect(document.css('.battle__hand-card-image').map { |node| node["src"] }.compact)
        .to include("/assets/cards/suibo.PNG")
      expect(document.css('[data-role="portrait"]').map { |node| node["src"] }.compact)
        .to include("/assets/portraits/suibo.PNG")
      expect(document.at_css(".battle")["style"]).to include("--battle-area-card-padding: 7px")
      expect(document.at_css(".battle")["style"]).to include("--battle-area-border-radius-ratio: 0.08")
      expect_battle_mobile_css(document, mobile_config)
      expect(document.css('[data-role="card-name"]').map { |node| node.text.strip }.uniq)
        .to match_array(%w[かぐや姫 アテナ 水母娘娘 テスラ ミダス])
      expect(document.css('.battle__hand-card [data-battle-animation-shadow]').size).to eq(10)
      expect(document.css('.battle__hand-card [data-battle-effect-layer]').size).to eq(10)
      expect(document.css('[data-battle-defeat-effect-layer]').size).to eq(2)
      expect(document.css('[data-battle-pre-screen]').size).to eq(0)
      expect(document.css('[data-battle-result-screen]').size).to eq(0)
      expect(document.css('.battle--cards-awaiting-entry').size).to eq(0)
      expect(document.css('[data-battle-entry-cover]').size).to eq(0)
      expect(document.css('[data-battle-surrender-open]').size).to eq(0)
      expect(document.css('[data-battle-surrender-layer]').size).to eq(0)
    end
  end
end
