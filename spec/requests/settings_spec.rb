require "rails_helper"

RSpec.describe "Settings", type: :request do
  before do
    reset!
    allow_any_instance_of(ActionView::Base).to receive(:stylesheet_link_tag).and_return("")
    allow_any_instance_of(ActionView::Base).to receive(:javascript_include_tag).and_return("")
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

  def authenticated_headers(user)
    @authenticated_headers ||= { "Cookie" => authentication_cookie_for(user) }
  end

  def password_params(password:, confirmation: password, current_password: nil)
    {
      password_settings: {
        current_password: current_password,
        password: password,
        password_confirmation: confirmation
      }
    }
  end

  describe "GET /settings" do
    it "redirects an unauthenticated user to the guide" do
      get settings_path

      expect(response).to redirect_to(guide_path)
    end

    it "shows the authenticated user's login id and settings navigation" do
      user = FactoryBot.create(:user, login_id: "ABCDEFGH", password_digest: nil)

      get settings_path, headers: authenticated_headers(user)

      document = Nokogiri::HTML(response.body)
      settings_links = document.css("a[href='#{settings_path}']")

      expect(response).to have_http_status(:ok)
      expect(response.body).to include("ABCDEFGH")
      expect(settings_links.any? { |link| link["class"].include?("app-sidebar__link") }).to be(true)
      expect(settings_links.any? { |link| link["class"].include?("app-header__settings-link") }).to be(true)
    end

    it "does not show a notification when an unset-password user has no completion" do
      user = FactoryBot.create(:user, password_digest: nil)

      get settings_path, headers: authenticated_headers(user)

      document = Nokogiri::HTML(response.body)

      expect(document.css("[data-password-setup-notification]")).to be_empty
    end

    it "shows header and sidebar notification elements when an unset-password user has a completion" do
      user = FactoryBot.create(:user, password_digest: nil)
      FactoryBot.create(:task_completion, user: user)

      get settings_path, headers: authenticated_headers(user)

      document = Nokogiri::HTML(response.body)

      expect(document.css('[data-password-setup-notification="header"]')).to be_one
      expect(document.css('[data-password-setup-notification="sidebar"]')).to be_one
    end

    it "does not show a notification when a password-set user has no completion" do
      user = FactoryBot.create(:user, password: "Password_1")

      get settings_path, headers: authenticated_headers(user)

      document = Nokogiri::HTML(response.body)

      expect(document.css("[data-password-setup-notification]")).to be_empty
    end

    it "does not show a notification when a password-set user has a completion" do
      user = FactoryBot.create(:user, password: "Password_1")
      FactoryBot.create(:task_completion, user: user)

      get settings_path, headers: authenticated_headers(user)

      document = Nokogiri::HTML(response.body)

      expect(document.css("[data-password-setup-notification]")).to be_empty
    end

    it "shows the warning and login id note without exposing password values when the password is unset" do
      user = FactoryBot.create(:user, login_id: "NOTEUSER", password_digest: nil)

      get settings_path, headers: authenticated_headers(user)

      document = Nokogiri::HTML(response.body)
      warning = document.at_css("[data-password-setup-warning]")

      expect(warning).to be_present
      expect(warning.text).to include("ブラウザ", "使用端末", "長期間", "Cookie", "再ログイン", "パスワード")
      expect(document.text).to include("NOTEUSER")
      expect(document.text).to include("ログインIDとパスワードは再ログイン時に必要になるため、控えておいてください。")
      expect(response.body).not_to include("password_digest")
    end

    it "hides the warning and does not expose the password or digest when the password is set" do
      raw_password = "Secret_1234"
      user = FactoryBot.create(:user, login_id: "SAFEUSER", password: raw_password)
      digest = user.password_digest

      get settings_path, headers: authenticated_headers(user)

      document = Nokogiri::HTML(response.body)

      expect(document.at_css("[data-password-setup-warning]")).to be_nil
      expect(document.text).to include("SAFEUSER")
      expect(response.body).not_to include(raw_password)
      expect(response.body).not_to include(digest)
      expect(response.body).not_to include("password_digest")
    end

    it "shows initial password registration fields when the digest is unset" do
      user = FactoryBot.create(:user, password_digest: nil)

      get settings_path, headers: authenticated_headers(user)

      document = Nokogiri::HTML(response.body)

      expect(document.at_css('input[name="password_settings[current_password]"]')).to be_nil
      expect(document.at_css('input[name="password_settings[password]"][type="password"]')).to be_present
      expect(document.at_css('input[name="password_settings[password_confirmation]"][type="password"]')).to be_present
      expect(document.at_css('[data-password-settings-form][data-password-registered="false"]')).to be_present
      expect(document.at_css("[data-password-confirmation-dialog]")).to be_nil
      expect(response.body).to include("パスワード登録")
    end

    it "shows password change fields when the digest exists" do
      user = FactoryBot.create(:user, password: "old_password")

      get settings_path, headers: authenticated_headers(user)

      document = Nokogiri::HTML(response.body)

      expect(document.at_css('input[name="password_settings[current_password]"][type="password"]')).to be_present
      expect(document.at_css('input[name="password_settings[password]"][type="password"]')).to be_present
      expect(document.at_css('input[name="password_settings[password_confirmation]"][type="password"]')).to be_present
      expect(document.at_css('[data-password-settings-form][data-password-registered="true"]')).to be_present
      expect(document.at_css("[data-password-confirmation-dialog]")).to be_nil
      expect(response.body).to include("パスワード変更")
    end

    it "provides nickname controls without a server-side nickname field" do
      user = FactoryBot.create(:user)

      get settings_path, headers: authenticated_headers(user)

      document = Nokogiri::HTML(response.body)
      nickname_form = document.at_css("[data-nickname-settings-form]")

      expect(nickname_form).to be_present
      expect(nickname_form["action"]).to be_nil
      expect(nickname_form.at_css("[data-nickname-settings-input]")).to be_present
    end
  end

  describe "PATCH /settings/password for an unset password" do
    let(:user) { FactoryBot.create(:user, password_digest: nil) }

    it "registers a valid password and creates a digest" do
      headers = authenticated_headers(user)

      patch settings_password_path,
            params: password_params(password: "Abc_1234"),
            headers: headers

      expect(response).to redirect_to(settings_path)
      expect(flash[:notice]).to eq("パスワードを登録しました。")
      expect(user.reload.password_digest).to be_present
      expect(user.authenticate("Abc_1234")).to eq(user)

      get settings_path, headers: headers

      expect(Nokogiri::HTML(response.body).at_css("[data-password-setup-warning]")).to be_nil
    end

    it "does not register when confirmation differs" do
      patch settings_password_path,
            params: password_params(password: "Abc_1234", confirmation: "Abc_1235"),
            headers: authenticated_headers(user)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.body).to include("一致しません")
      expect(user.reload.password_digest).to be_nil
    end

    it "does not register a password shorter than four characters" do
      patch settings_password_path,
            params: password_params(password: "Ab3"),
            headers: authenticated_headers(user)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.body).to include("4文字以上")
      expect(user.reload.password_digest).to be_nil
    end

    it "does not register characters outside ASCII letters, numbers, and underscore" do
      ["abcd-123", "ａｂｃｄ", "abcd!"].each do |invalid_password|
        patch settings_password_path,
              params: password_params(password: invalid_password),
              headers: authenticated_headers(user)

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.body).to include("半角英字、半角数字、_のみ")
        expect(user.reload.password_digest).to be_nil
      end
    end

    it "does not register a password containing whitespace" do
      patch settings_password_path,
            params: password_params(password: "abcd 1234"),
            headers: authenticated_headers(user)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.body).to include("半角英字、半角数字、_のみ")
      expect(user.reload.password_digest).to be_nil
    end

    it "enforces bcrypt's technical limit of 72 ASCII characters" do
      patch settings_password_path,
            params: password_params(password: "a" * 73),
            headers: authenticated_headers(user)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.body).to include("bcryptの技術上限である72文字以内")
      expect(user.reload.password_digest).to be_nil
    end

    it "keeps the existing authentication token after registration" do
      headers = authenticated_headers(user)
      authentication_token_digest = user.reload.authentication_token_digest

      patch settings_password_path,
            params: password_params(password: "Abc_1234"),
            headers: headers

      expect(user.reload.authentication_token_digest).to eq(authentication_token_digest)

      get settings_path, headers: headers

      expect(response).to have_http_status(:ok)
    end

    it "does not redisplay a submitted password after failure" do
      patch settings_password_path,
            params: password_params(password: "do-not-display"),
            headers: authenticated_headers(user)

      expect(response.body).not_to include("do-not-display")
    end
  end

  describe "PATCH /settings/password for a registered password" do
    let(:user) { FactoryBot.create(:user, password: "old_password") }

    it "changes the password when the current password is correct" do
      patch settings_password_path,
            params: password_params(password: "New_1234", current_password: "old_password"),
            headers: authenticated_headers(user)

      expect(response).to redirect_to(settings_path)
      expect(flash[:notice]).to eq("パスワードを変更しました。")
      expect(user.reload.authenticate("New_1234")).to eq(user)
      expect(user.authenticate("old_password")).to be(false)
    end

    it "does not change the password when the current password is incorrect" do
      original_digest = user.password_digest

      patch settings_password_path,
            params: password_params(password: "New_1234", current_password: "incorrect"),
            headers: authenticated_headers(user)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.body).to include("現在のパスワードが正しくありません")
      expect(user.reload.password_digest).to eq(original_digest)
      expect(user.authenticate("old_password")).to eq(user)
    end

    it "does not change the password when confirmation differs" do
      original_digest = user.password_digest

      patch settings_password_path,
            params: password_params(
              password: "New_1234",
              confirmation: "New_1235",
              current_password: "old_password"
            ),
            headers: authenticated_headers(user)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(user.reload.password_digest).to eq(original_digest)
    end

    it "keeps the existing authentication token after changing the password" do
      headers = authenticated_headers(user)
      authentication_token_digest = user.reload.authentication_token_digest

      patch settings_password_path,
            params: password_params(password: "New_1234", current_password: "old_password"),
            headers: headers

      expect(user.reload.authentication_token_digest).to eq(authentication_token_digest)

      get settings_path, headers: headers

      expect(response).to have_http_status(:ok)
    end
  end
end
