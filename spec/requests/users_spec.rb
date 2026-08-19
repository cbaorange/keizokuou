require "rails_helper"

RSpec.describe "Users", type: :request do
  let(:valid_params) do
    {
      registration: {
        nickname: "テストユーザー",
        job: "毎日30分プログラミングする",
        partner: "1"
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
    it "shows the registration fields with the selected partner hidden" do
      get new_user_path(partner: "1")

      document = Nokogiri::HTML(response.body)

      expect(response).to have_http_status(:ok)
      expect(document.at_css('input[name="registration[job]"]')).to be_present
      nickname_input = document.at_css('input[name="registration[nickname]"]')
      expect(nickname_input).to be_present
      expect(nickname_input.attributes).to have_key("required")
      expect(document.at_css('label[for="registration_nickname"]').text.strip).to eq("ニックネーム")
      partner_input = document.at_css('input[name="registration[partner]"][type="hidden"]')
      expect(partner_input["value"]).to eq("1")
      expect(response.body).not_to include("最も当てはまるもの")
      expect(document.at_css('input[type="password"]')).to be_nil
      expect(document.at_css('form[data-registration-form="true"]')).to be_present
      expect(document.at_css('[data-registration-submit="true"]')).to be_present
      expect(document.at_css(".account-tabs")).to be_nil
      relogin_link = document.at_css(".account-form__switch-link[href='#{login_path}']")
      expect(relogin_link.text.strip).to eq("再ログイン")
      expect(relogin_link.parent.text.strip)
        .to eq("すでにアカウントを持っている方はこちら：再ログイン")
      expect(response.body).not_to include("すでに引き継ぎ用パスワードを設定済みですか？")
      expect(document.at_css(".account-switch")).to be_nil
      expect(response.body).not_to include("登録後に表示されるログインID")
      expect(response.body).not_to include("かぐや姫と始める")
      expect(response.body).not_to include("app-sidebar__nav")
      expect(response.body).not_to include("ログインIDは、今後追加予定の設定画面で確認できるようになります。")
      expect(document.at_css(".app-header")).to be_nil
    end

    it "redirects a missing or unsupported partner to the guide" do
      get new_user_path
      expect(response).to redirect_to(guide_path)

      get new_user_path(partner: "6")
      expect(response).to redirect_to(guide_path)

      get new_user_path(partner: "new_challenge")
      expect(response).to redirect_to(guide_path)
    end
  end

  describe "POST /users" do
    (1..5).each do |partner_id|
      it "creates card #{partner_id} from partner id #{partner_id}" do
        params = valid_params.deep_dup
        params[:registration][:partner] = partner_id.to_s

        expect {
          post users_path, params: params
        }.to change(User, :count).by(1)
          .and change(UserCard, :count).by(1)

        expect(User.last.user_cards.last.card_id).to eq(partner_id)
      end
    end

    it "creates Suibo Nyannyan for the healing choice and shows its initial reward" do
      params = valid_params.deep_dup
      params[:registration][:partner] = "3"

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
      params[:registration][:job] = ""

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

    it "requires nickname and task content after a managed partner was selected" do
      expect {
        post users_path, params: {
          registration: { partner: "1" }
        }
      }.not_to change(User, :count)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.body).to include("ニックネームを入力してください")
      expect(response.body).to include("継続することを入力してください")
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

    it "rejects an unsupported partner without creating a user or cookie" do
      invalid_params = valid_params.deep_dup
      invalid_params[:registration][:partner] = "6"

      expect {
        post users_path, params: invalid_params
      }.not_to change(User, :count)

      expect(response).to redirect_to(guide_path)
      expect(authentication_cookie_header).to be_blank
    end

    it "redirects a missing partner without creating a user or cookie" do
      invalid_params = valid_params.deep_dup
      invalid_params[:registration].delete(:partner)

      expect {
        post users_path, params: invalid_params
      }.not_to change(User, :count)

      expect(response).to redirect_to(guide_path)
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

    it "keeps entered values and the partner when validation fails" do
      post users_path, params: {
        registration: {
          job: "読書を続ける",
          partner: "1"
        }
      }

      expect(response.body).to include("読書を続ける")
      expect(response).to have_http_status(:unprocessable_entity)
      document = Nokogiri::HTML(response.body)
      expect(document.at_css('input[name="registration[partner]"]')["value"])
        .to eq("1")
      expect(document.at_css(".account-tabs")).to be_nil
      expect(document.at_css(".account-form__switch-link")["href"])
        .to eq(login_path)
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
