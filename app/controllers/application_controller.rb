class ApplicationController < ActionController::Base
  AUTHENTICATION_COOKIE_NAME = :keizokuou_authentication
  INITIAL_TASK_DESCRIPTION = "タスクを追加するときは、⚙️を押してください。".freeze

  before_action :require_authentication
  helper_method :current_user, :password_setup_notification?

  protected

  # 暗号化CookieのユーザーIDと生トークンを検証し、認証できたユーザーだけを返す
  def current_user
    return @current_user if defined?(@current_user)

    @current_user = user_from_authentication_cookie
  end

  # パスワード未設定のまま日次達成記録を持つユーザーへ、設定を促すか判定する
  def password_setup_notification?
    return @password_setup_notification if defined?(@password_setup_notification)

    @password_setup_notification = current_user.present? &&
                                   current_user.password_digest.blank? &&
                                   current_user.task_completions.exists?
  end

  # 新しい生トークンを発行してCookieへ保存し、同じリクエスト内では認証済みとして扱う
  def establish_authentication_for(user)
    raw_token = user.issue_authentication_token!
    write_authentication_cookie(user_id: user.id, raw_token: raw_token)
    @current_user = user
  end

  # DB上のトークンを失効させず、このアプリの認証Cookieだけを削除する
  def clear_authentication_cookie
    cookies.delete(AUTHENTICATION_COOKIE_NAME, path: "/")
    @current_user = nil
  end

  # 認証成功後のタスク画面だけに、ローカル保存するタスク1の内容を渡す
  def queue_initial_task(job)
    flash[:task_setup] = {
      "job" => job,
      "description" => INITIAL_TASK_DESCRIPTION
    }
  end

  # 認証できない場合は初回導線のガイドへ移動する
  def require_authentication
    redirect_to guide_path unless current_user
  end

  private

  # Cookieの内容を順番に検証し、利用不能なCookieは削除して未認証として扱う
  def user_from_authentication_cookie
    cookie_exists = cookies[AUTHENTICATION_COOKIE_NAME].present?
    authentication = read_authentication_cookie

    unless authentication.is_a?(Hash)
      clear_authentication_cookie if cookie_exists
      return nil
    end

    authentication = authentication.with_indifferent_access
    user_id = authentication[:user_id]
    raw_token = authentication[:raw_token]

    unless user_id.present? && raw_token.is_a?(String) && raw_token.present?
      clear_authentication_cookie
      return nil
    end

    user = User.find_by(id: user_id)

    unless user&.authentication_token_valid?(raw_token)
      clear_authentication_cookie
      return nil
    end

    # 認証成功時はトークンを変更せず、同じ認証情報で有効期限だけを延長する
    write_authentication_cookie(user_id: user.id, raw_token: raw_token)
    user
  end

  # Rails標準の暗号化Cookieを読み、改ざんや破損による復号失敗だけを未認証へ変換する
  def read_authentication_cookie
    cookies.encrypted[AUTHENTICATION_COOKIE_NAME]
  rescue ActiveSupport::MessageEncryptor::InvalidMessage,
         ActiveSupport::MessageVerifier::InvalidSignature
    nil
  end

  # 発行時と期限更新時で同じCookie属性を使用する
  def write_authentication_cookie(user_id:, raw_token:)
    cookies.encrypted[AUTHENTICATION_COOKIE_NAME] = {
      value: {
        user_id: user_id,
        raw_token: raw_token
      },
      expires: 1.year.from_now,
      httponly: true,
      same_site: :lax,
      secure: Rails.env.production?,
      path: "/"
    }
  end
end
