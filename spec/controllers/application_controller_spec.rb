require "rails_helper"

RSpec.describe ApplicationController, type: :controller do
  controller(ApplicationController) do
    # スペックは、ログインページへリダイレクトしない
    skip_before_action :require_authentication

    # 本番ルートを増やさず、current_userの外部から見た結果だけを返すテスト用action
    def authentication_status
      render plain: current_user&.id.to_s
    end

    # 1リクエスト中にcurrent_userを複数回利用する状況を再現するテスト用action
    def repeated_authentication_status
      first_user = current_user
      second_user = current_user
      render plain: [first_user&.id, second_user&.id].join(",")
    end

    # 将来の登録処理と同じ経路で認証Cookieを発行するテスト用action
    def issue_authentication
      establish_authentication_for(User.find(params[:user_id]))
      render plain: current_user.id.to_s
    end

    # 将来の失効処理と同じ経路で認証Cookieだけを削除するテスト用action
    def clear_authentication
      clear_authentication_cookie
      head :no_content
    end
  end

  before do
    routes.draw do
      get "authentication_status" => "anonymous#authentication_status"
      get "repeated_authentication_status" => "anonymous#repeated_authentication_status"
      post "issue_authentication" => "anonymous#issue_authentication"
      delete "clear_authentication" => "anonymous#clear_authentication"
    end
  end

  def set_encrypted_authentication_cookie(user_id:, raw_token:)
    cookies.encrypted[ApplicationController::AUTHENTICATION_COOKIE_NAME] = {
      value: {
        user_id: user_id,
        raw_token: raw_token
      },
      expires: 1.month.from_now,
      httponly: true,
      same_site: :lax,
      secure: false,
      path: "/"
    }
  end

  def authentication_set_cookie_header
    response.headers["Set-Cookie"].to_s
  end

  def expect_authentication_cookie_to_be_deleted
    expect(authentication_set_cookie_header).to include(
      "#{ApplicationController::AUTHENTICATION_COOKIE_NAME}=;"
    )
    expect(authentication_set_cookie_header).to match(
      /expires=Thu, 01 Jan 1970 00:00:00 GMT/i
    )
  end

  describe "#current_user" do
    # Cookieがないリクエストを未認証として扱えるか
    it "returns nil without an authentication cookie" do
      get :authentication_status

      expect(response.body).to eq("")
    end

    # ユーザーIDと正しい生トークンがそろったCookieで認証できるか
    it "returns the user for a valid authentication cookie" do
      user = FactoryBot.create(:user)
      raw_token = user.issue_authentication_token!
      set_encrypted_authentication_cookie(user_id: user.id, raw_token: raw_token)

      get :authentication_status

      expect(response.body).to eq(user.id.to_s)
    end

    # 認証成功時にCookie期限が再び1年後へ延長されるか
    it "renews the cookie expiration after successful authentication" do
      user = FactoryBot.create(:user)
      raw_token = user.issue_authentication_token!
      set_encrypted_authentication_cookie(user_id: user.id, raw_token: raw_token)

      get :authentication_status

      expires_value = authentication_set_cookie_header[/expires=([^;]+)/i, 1]
      expect(Time.httpdate(expires_value)).to be_within(5.seconds).of(1.year.from_now)
    end

    # 認証CookieをJavaScriptから読み取れない属性で再発行できるか
    it "renews the cookie with the HttpOnly attribute" do
      user = FactoryBot.create(:user)
      raw_token = user.issue_authentication_token!
      set_encrypted_authentication_cookie(user_id: user.id, raw_token: raw_token)

      get :authentication_status

      expect(authentication_set_cookie_header).to include("HttpOnly")
    end

    # 通常のサイト遷移で利用でき、クロスサイト送信を抑える属性で再発行できるか
    it "renews the cookie with the SameSite Lax attribute" do
      user = FactoryBot.create(:user)
      raw_token = user.issue_authentication_token!
      set_encrypted_authentication_cookie(user_id: user.id, raw_token: raw_token)

      get :authentication_status

      expect(authentication_set_cookie_header).to include("SameSite=Lax")
    end

    # テスト環境ではHTTPでも利用できるようSecure属性を付けないか
    it "does not set the Secure attribute outside production" do
      user = FactoryBot.create(:user)
      raw_token = user.issue_authentication_token!
      set_encrypted_authentication_cookie(user_id: user.id, raw_token: raw_token)

      get :authentication_status

      expect(authentication_set_cookie_header).not_to match(/;\s*secure(?:;|$)/i)
    end

    # ユーザーIDがないCookieを未認証として削除できるか
    it "returns nil when the user id is nil" do
      set_encrypted_authentication_cookie(user_id: nil, raw_token: "token")

      get :authentication_status

      expect(response.body).to eq("")
      expect_authentication_cookie_to_be_deleted
    end

    # 存在しないユーザーIDだけでは認証を成立させないか
    it "returns nil for a missing user" do
      set_encrypted_authentication_cookie(user_id: 0, raw_token: "token")

      get :authentication_status

      expect(response.body).to eq("")
      expect_authentication_cookie_to_be_deleted
    end

    # ユーザーIDが正しくてもトークンが違えば認証を成立させないか
    it "returns nil for an incorrect token" do
      user = FactoryBot.create(:user)
      user.issue_authentication_token!
      set_encrypted_authentication_cookie(user_id: user.id, raw_token: "incorrect_token")

      get :authentication_status

      expect(response.body).to eq("")
      expect_authentication_cookie_to_be_deleted
    end

    # 生トークンがnilのCookieを未認証として削除できるか
    it "returns nil when the raw token is nil" do
      user = FactoryBot.create(:user)
      set_encrypted_authentication_cookie(user_id: user.id, raw_token: nil)

      get :authentication_status

      expect(response.body).to eq("")
      expect_authentication_cookie_to_be_deleted
    end

    # 生トークンが空文字列のCookieを未認証として削除できるか
    it "returns nil when the raw token is empty" do
      user = FactoryBot.create(:user)
      set_encrypted_authentication_cookie(user_id: user.id, raw_token: "")

      get :authentication_status

      expect(response.body).to eq("")
      expect_authentication_cookie_to_be_deleted
    end

    # DB上で失効済みのトークンをCookieから再利用できないか
    it "returns nil for a revoked token" do
      user = FactoryBot.create(:user)
      raw_token = user.issue_authentication_token!
      user.revoke_authentication_token!
      set_encrypted_authentication_cookie(user_id: user.id, raw_token: raw_token)

      get :authentication_status

      expect(response.body).to eq("")
      expect_authentication_cookie_to_be_deleted
    end

    # 改ざんまたは破損した暗号化Cookieで例外を発生させず削除できるか
    it "returns nil and deletes a tampered encrypted cookie" do
      cookies[ApplicationController::AUTHENTICATION_COOKIE_NAME] = "tampered_cookie"

      expect { get :authentication_status }.not_to raise_error

      expect(response.body).to eq("")
      expect_authentication_cookie_to_be_deleted
    end

    # メモ化により同じリクエスト内の照合とCookie更新を一度だけにできるか
    it "authenticates and renews the cookie only once per request" do
      user = FactoryBot.create(:user)
      raw_token = user.issue_authentication_token!
      set_encrypted_authentication_cookie(user_id: user.id, raw_token: raw_token)
      allow(User).to receive(:find_by).and_return(user)

      expect(user).to receive(:authentication_token_valid?).once.with(raw_token).and_call_original
      expect(controller).to receive(:write_authentication_cookie).once.and_call_original

      get :repeated_authentication_status

      expect(response.body).to eq("#{user.id},#{user.id}")
    end
  end

  describe "#establish_authentication_for" do
    # 生トークンをCookieだけへ保存し、DBには照合用ダイジェストだけを残せるか
    it "issues a token and stores the raw token only in the encrypted cookie" do
      user = FactoryBot.create(:user, authentication_token_digest: nil)

      post :issue_authentication, params: { user_id: user.id }

      authentication = cookies.encrypted[ApplicationController::AUTHENTICATION_COOKIE_NAME]
      raw_token = authentication.with_indifferent_access[:raw_token]

      expect(response.body).to eq(user.id.to_s)
      expect(authentication.keys.map(&:to_s)).to contain_exactly("user_id", "raw_token")
      expect(authentication.with_indifferent_access[:user_id]).to eq(user.id)
      expect(raw_token).to be_present
      expect(user.reload.authentication_token_digest).to be_present
      expect(user.authentication_token_valid?(raw_token)).to be(true)
      expect(user.attributes.values).not_to include(raw_token)
    end
  end

  describe "#clear_authentication_cookie" do
    # 他のCookieを残したまま認証Cookieだけを削除できるか
    it "deletes only the authentication cookie" do
      cookies[ApplicationController::AUTHENTICATION_COOKIE_NAME] = "authentication"
      cookies[:unrelated_cookie] = "keep"

      delete :clear_authentication

      expect_authentication_cookie_to_be_deleted
      expect(cookies[:unrelated_cookie]).to eq("keep")
    end
  end
end
