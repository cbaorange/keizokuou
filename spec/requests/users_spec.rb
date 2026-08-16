require "rails_helper"

RSpec.describe "Users", type: :request do
  let(:valid_params) do
    {
      registration: {
        nickname: "テストユーザー",
        job: "毎日30分プログラミングする",
        choice: "new_challenge"
      }
    }
  end

  before do
    reset!
  end

  def authentication_cookie_header
    response.headers["Set-Cookie"].to_s.lines.find do |cookie|
      cookie.start_with?("#{ApplicationController::AUTHENTICATION_COOKIE_NAME}=")
    end.to_s
  end

  def decrypted_authentication_cookie
    cookie_pair = authentication_cookie_header.split(";").first
    cookie_request = ActionDispatch::Request.new(
      Rails.application.env_config.merge("HTTP_COOKIE" => cookie_pair)
    )

    cookie_request.cookie_jar.encrypted[
      ApplicationController::AUTHENTICATION_COOKIE_NAME
    ]
  end

  describe "GET /users/new" do
    it "shows one task field, five choices, and no password field" do
      get new_user_path

      document = Nokogiri::HTML(response.body)

      expect(response).to have_http_status(:ok)
      expect(document.at_css('input[name="registration[job]"]')).to be_present
      nickname_input = document.at_css('input[name="registration[nickname]"]')
      expect(nickname_input).to be_present
      expect(nickname_input.attributes).to have_key("required")
      expect(document.at_css('label[for="registration_nickname"]').text.strip).to eq("ニックネーム")
      expect(document.css('input[name="registration[choice]"][type="radio"]').size).to eq(5)
      choice_labels = document.css(".account-choice__label").map { |label| label.text.strip }
      expect(choice_labels).to include("癒されたい")
      expect(choice_labels).not_to include("計画的に取り組みたい")
      expect(document.at_css('input[type="password"]')).to be_nil
      expect(document.at_css('form[data-registration-form="true"]')).to be_present
      expect(document.at_css('[data-registration-submit="true"]')).to be_present
      registration_tab = document.at_css(".account-tabs__link--current")
      login_tab = document.at_css(".account-tabs a[href='#{login_path}']")
      expect(registration_tab.text.strip).to eq("新規登録")
      expect(registration_tab["aria-current"]).to eq("page")
      expect(login_tab.text.strip).to eq("ログイン")
      expect(response.body).not_to include("すでに引き継ぎ用パスワードを設定済みですか？")
      expect(document.at_css(".account-switch")).to be_nil
      expect(response.body).not_to include("登録後に表示されるログインID")
      expect(response.body).not_to include("かぐや姫と始める")
      expect(response.body).not_to include("app-sidebar__nav")
      expect(response.body).not_to include("ログインIDは、今後追加予定の設定画面で確認できるようになります。")
      expect(document.at_css(".app-header")).to be_nil
    end
  end

  describe "POST /users" do
    it "creates a user and the selected initial card" do
      expect {
        post users_path, params: valid_params
      }.to change(User, :count).by(1)
        .and change(UserCard, :count).by(1)

      expect(User.last.user_cards.last.card_id).to eq(1)
    end

    it "creates Suibo Nyannyan for the healing choice and shows its initial reward" do
      params = valid_params.deep_dup
      params[:registration][:choice] = "planned_action"

      expect {
        post users_path, params: params
      }.to change(User, :count).by(1)
        .and change(UserCard, :count).by(1)

      expect(User.last.user_cards.last.card_id).to eq(3)

      follow_redirect!

      modal = Nokogiri::HTML(response.body).at_css("[data-card-reward-modal]")
      reward = JSON.parse(modal["data-initial-card-reward"])

      expect(reward).to include(
        "cardId" => 3,
        "cardName" => "すいぼにゃんにゃん"
      )
      expect(reward.fetch("cardImagePath")).to include("cards/suibo")
    end

    it "creates a user with the existing generated login id rule" do
      post users_path, params: valid_params

      expect(User.last.login_id).to match(/\A[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}\z/)
    end

    it "leaves the password digest unset" do
      post users_path, params: valid_params

      expect(User.last.password_digest).to be_nil
    end

    it "creates the initial card with 1 exp" do
      post users_path, params: valid_params

      expect(User.last.user_cards.find_by(card_id: 1).exp).to eq(1)
    end

    it "issues the existing encrypted authentication cookie after persistence" do
      post users_path, params: valid_params

      authentication = decrypted_authentication_cookie.with_indifferent_access
      user = User.last
      raw_token = authentication[:raw_token]

      expect(authentication.keys).to contain_exactly("user_id", "raw_token")
      expect(authentication[:user_id]).to eq(user.id)
      expect(user.authentication_token_valid?(raw_token)).to be(true)
      expect(user.attributes.values).not_to include(raw_token)
    end

    it "does not expose the generated login id when debug mode is off" do
      stub_const("Debug::ENABLED", false)

      post users_path, params: valid_params
      user = User.last

      expect(response).to redirect_to(root_path)

      follow_redirect!

      expect(response.body).to include("登録が完了しました。")
      expect(response.body).not_to include(user.login_id)
      expect(response.body).not_to include("デバッグ用ログインID")
    end

    it "shows the generated login id once when debug mode is on" do
      stub_const("Debug::ENABLED", true)

      post users_path, params: valid_params
      user = User.last
      follow_redirect!

      expect(response.body).to include("登録が完了しました。")
      expect(response.body).to include("デバッグ用ログインID：#{user.login_id}")

      get root_path

      expect(response.body).not_to include(user.login_id)
    end

    it "does not expose the login id in production even when debug is on" do
      stub_const("Debug::ENABLED", true)
      allow(Rails).to receive(:env)
        .and_return(ActiveSupport::EnvironmentInquirer.new("production"))

      post users_path, params: valid_params
      user = User.last

      expect(flash[:notice]).to eq("登録が完了しました。")
      expect(flash[:notice]).not_to include(user.login_id)
      expect(flash[:notice]).not_to include("デバッグ用ログインID")
    end

    it "passes task 1 content to the task page only after successful registration" do
      post users_path, params: valid_params
      follow_redirect!

      document = Nokogiri::HTML(response.body)
      app_content = document.at_css(".app-content[data-offset-date]")

      expect(app_content["data-task-setup-job"]).to eq("毎日30分プログラミングする")
      expect(app_content["data-task-setup-description"]).to eq(
        ApplicationController::INITIAL_TASK_DESCRIPTION
      )
      expect(document.css(".app-flash").map(&:text)).not_to include(
        a_string_including("job")
      )
    end

    it "passes the trimmed nickname to localStorage setup only after success" do
      params = valid_params.deep_dup
      params[:registration][:nickname] = " しば "

      post users_path, params: params
      follow_redirect!

      app_content = Nokogiri::HTML(response.body).at_css(
        ".app-content[data-nickname-to-store]"
      )

      expect(app_content["data-nickname-to-store"]).to eq(" しば ")

      get root_path
      expect(response.body).not_to include("data-nickname-to-store")
    end

    it "does not pass a nickname to localStorage setup after failure" do
      params = valid_params.deep_dup
      params[:registration][:nickname] = "上書きしない"
      params[:registration][:choice] = "invalid"

      post users_path, params: params

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.body).not_to include("data-nickname-to-store")
      expect(response.body).to include("上書きしない")
    end

    it "passes the initial card reward to the task page only once" do
      post users_path, params: valid_params

      expect(response).to redirect_to(root_path)

      follow_redirect!

      document = Nokogiri::HTML(response.body)
      modal = document.at_css("[data-card-reward-modal]")
      experience = document.at_css("[data-card-reward-experience]")
      reward = JSON.parse(modal["data-initial-card-reward"])

      expect(reward).to include(
        "cardId" => 1,
        "isNew" => true,
        "title" => "新しいカードを獲得しました！",
        "cardName" => "かぐや姫",
        "showExperience" => false
      )
      expect(reward.fetch("cardImagePath")).to include("cards/kaguya")
      expect(experience.attributes).to have_key("hidden")

      get root_path

      reloaded_document = Nokogiri::HTML(response.body)
      reloaded_modal = reloaded_document.at_css("[data-card-reward-modal]")
      reloaded_experience = reloaded_document.at_css(
        "[data-card-reward-experience]"
      )

      expect(reloaded_modal["data-initial-card-reward"]).to be_nil
      expect(reloaded_experience.attributes).not_to have_key("hidden")
    end

    it "requires nickname, task content, and a managed choice" do
      expect {
        post users_path, params: { registration: {} }
      }.not_to change(User, :count)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.body).to include("ニックネームを入力してください")
      expect(response.body).to include("継続することを入力してください")
      expect(response.body).to include("最も当てはまるものを選択してください")
      expect(authentication_cookie_header).to be_blank
    end

    it "rejects a whitespace-only nickname" do
      invalid_params = valid_params.deep_dup
      invalid_params[:registration][:nickname] = "   "

      expect {
        post users_path, params: invalid_params
      }.not_to change(User, :count)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.body).to include("ニックネームを入力してください")
      expect(authentication_cookie_header).to be_blank
    end

    it "rejects an unsupported choice without creating a user or cookie" do
      invalid_params = valid_params.deep_dup
      invalid_params[:registration][:choice] = "card_id_999"

      expect {
        post users_path, params: invalid_params
      }.not_to change(User, :count)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(authentication_cookie_header).to be_blank
    end

    it "does not trust a card id sent by the form" do
      params_with_card_id = valid_params.deep_merge(
        registration: { card_id: 5 }
      )

      post users_path, params: params_with_card_id

      expect(User.last.user_cards.pluck(:card_id)).to eq([1])
    end

    it "rolls back the user when initial card persistence fails" do
      user = User.build_for_registration
      card_association = user.user_cards
      invalid_card = UserCard.new
      invalid_card.errors.add(:base, "初期カードを保存できません")

      allow(User).to receive(:build_for_registration).and_return(user)
      allow(user).to receive(:user_cards).and_return(card_association)
      allow(card_association).to receive(:create!)
        .and_raise(ActiveRecord::RecordInvalid.new(invalid_card))

      expect {
        post users_path, params: valid_params
      }.not_to change(User, :count)

      expect(UserCard.count).to eq(0)
      expect(response).to have_http_status(:unprocessable_entity)
      expect(authentication_cookie_header).to be_blank
    end

    it "keeps entered non-secret values when validation fails" do
      post users_path, params: {
        registration: {
          job: "読書を続ける",
          choice: "invalid"
        }
      }

      expect(response.body).to include("読書を続ける")
      expect(response).to have_http_status(:unprocessable_entity)
    end

    it "does not accept externally supplied user attributes" do
      post users_path, params: valid_params.deep_merge(
        user: {
          login_id: "INPUT999",
          password: "password",
          password_digest: "external_digest"
        }
      )

      user = User.last
      expect(user.login_id).not_to eq("INPUT999")
      expect(user.password_digest).to be_nil
    end

    it "returns an error without persistence when account id generation is exhausted" do
      allow(User).to receive(:build_for_registration)
        .and_raise(User::AccountIdGenerationError)

      expect {
        post users_path, params: valid_params
      }.not_to change(User, :count)

      expect(response).to have_http_status(:internal_server_error)
      expect(authentication_cookie_header).to be_blank
    end
  end
end
