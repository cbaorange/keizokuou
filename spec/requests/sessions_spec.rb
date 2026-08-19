require "rails_helper"

RSpec.describe "Sessions", type: :request do
  let(:password) { "secure-password" }
  let(:user) do
    created_user = FactoryBot.create(
      :user,
      login_id: "ABCDEFGH",
      password: password,
      password_confirmation: password
    )
    FactoryBot.create(:user_card, user: created_user, card_id: 1)
    created_user
  end
  let(:valid_params) do
    {
      session: {
        login_id: user.login_id,
        password: password,
        nickname: "テストユーザー",
        job: "運動を再開する"
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

  describe "GET /login" do
    it "shows login id, password, task fields, and no sidebar" do
      get login_path

      document = Nokogiri::HTML(response.body)

      expect(response).to have_http_status(:ok)
      expect(document.at_css('input[name="session[login_id]"]')).to be_present
      expect(document.at_css('input[name="session[password]"][type="password"]')).to be_present
      expect(document.at_css('input[name="session[job]"]')).to be_present
      nickname_input = document.at_css('input[name="session[nickname]"]')
      expect(nickname_input).to be_present
      expect(nickname_input.attributes).to have_key("required")
      expect(document.at_css('label[for="session_nickname"]').text.strip).to eq("ニックネーム")
      expect(document.at_css(".account-tabs")).to be_nil
      guide_link = document.at_css(".account-form__switch-link[href='#{guide_path}']")
      expect(guide_link.text.strip).to eq("こちらのページでシュカモンを選択")
      expect(guide_link.parent.text.strip)
        .to eq("初めてプレイする方は、こちらのページでシュカモンを選択")
      expect(response.body).not_to include("はじめて利用しますか？")
      expect(document.at_css(".account-switch")).to be_nil
      expect(response.body).not_to include("app-sidebar__nav")
      expect(document.at_css(".app-header")).to be_nil
    end
  end

  describe "POST /login" do
    it "logs in a user with a configured password and correct credentials" do
      post login_path, params: valid_params

      expect(response).to redirect_to(root_path)
      expect(authentication_cookie_header).to include(
        ApplicationController::AUTHENTICATION_COOKIE_NAME.to_s
      )
      expect(user.reload.authentication_token_digest).to be_present
    end

    it "passes task 1 content to the task page after successful login" do
      post login_path, params: valid_params
      follow_redirect!

      document = Nokogiri::HTML(response.body)
      app_content = document.at_css(".app-content[data-offset-date]")

      expect(app_content["data-task-setup-job"]).to eq("運動を再開する")
      expect(app_content["data-task-setup-description"]).to eq(
        ApplicationController::INITIAL_TASK_DESCRIPTION
      )
      expect(document.css(".app-flash").map(&:text)).to contain_exactly(
        a_string_including("再ログインしました")
      )
    end

    it "passes the nickname to localStorage setup only after successful login" do
      params = valid_params.deep_dup
      params[:session][:nickname] = " しば "

      post login_path, params: params
      follow_redirect!

      app_content = Nokogiri::HTML(response.body).at_css(
        ".app-content[data-nickname-to-store]"
      )

      expect(app_content["data-nickname-to-store"]).to eq(" しば ")
    end

    it "rejects an incorrect password without issuing a cookie" do
      invalid_params = valid_params.deep_dup
      invalid_params[:session][:password] = "incorrect"
      invalid_params[:session][:nickname] = "上書きしない"

      post login_path, params: invalid_params

      expect(response).to have_http_status(:unprocessable_entity)
      expect(authentication_cookie_header).to be_blank
      expect(user.reload.authentication_token_digest).to be_nil
      expect(response.body).not_to include("data-nickname-to-store")
      expect(response.body).to include("上書きしない")
    end

    it "rejects a user whose password digest is unset" do
      passwordless_user = FactoryBot.create(
        :user,
        login_id: "ZZZZZZZZ",
        password_digest: nil
      )

      post login_path, params: {
        session: {
          login_id: passwordless_user.login_id,
          password: "any-password",
          nickname: "テストユーザー",
          job: "読書を再開する"
        }
      }

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.body).to include("引き継ぎ用パスワードが設定されていないため")
      expect(authentication_cookie_header).to be_blank
      expect(passwordless_user.reload.authentication_token_digest).to be_nil
    end

    it "rejects an unknown login id without issuing a cookie" do
      post login_path, params: {
        session: {
          login_id: "ZZZZZZZZ",
          password: password,
          nickname: "テストユーザー",
          job: "読書を再開する"
        }
      }

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.body).to include("ログインIDまたはパスワードが正しくありません")
      expect(authentication_cookie_header).to be_blank
    end

    it "requires all four fields" do
      post login_path, params: { session: {} }

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.body).to include("ニックネームを入力してください")
      expect(response.body).to include("ログインIDを入力してください")
      expect(response.body).to include("パスワードを入力してください")
      expect(response.body).to include("再び継続することを入力してください")
      expect(authentication_cookie_header).to be_blank
    end

    it "rejects a whitespace-only nickname without issuing a cookie" do
      invalid_params = valid_params.deep_dup
      invalid_params[:session][:nickname] = "   "

      post login_path, params: invalid_params

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.body).to include("ニックネームを入力してください")
      expect(authentication_cookie_header).to be_blank
      expect(user.reload.authentication_token_digest).to be_nil
    end

    it "keeps non-secret fields but does not redisplay the password after failure" do
      post login_path, params: {
        session: {
          login_id: user.login_id,
          password: "do-not-redisplay",
          nickname: "テストユーザー",
          job: "読書を再開する"
        }
      }

      expect(response.body).to include(user.login_id)
      expect(response.body).to include("読書を再開する")
      expect(response.body).not_to include("do-not-redisplay")
    end
  end
end
