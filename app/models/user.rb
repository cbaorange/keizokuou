require "digest"
require "securerandom"

class User < ApplicationRecord
  ACCOUNT_ID_CHARACTERS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ".freeze
  ACCOUNT_ID_LENGTH = 8
  ACCOUNT_ID_GENERATION_ATTEMPTS = 10

  # 通常の登録失敗とID候補の枯渇を呼び出し元が区別するための例外
  class AccountIdGenerationError < StandardError; end

  has_many :user_cards
  has_many :task_completions
  has_many :battle_sessions

  # 引き継ぎ用パスワードが設定済みのユーザーだけを安全に照合する
  has_secure_password validations: false

  # ログインIDは空欄不可。同じIDを複数ユーザーが使用することも禁止する
  validates :login_id, presence: true, uniqueness: true

  # 外部入力を使わず、生成済みアカウントIDと未設定パスコードで登録用Userを組み立てる
  def self.build_for_registration
    new(
      login_id: generate_unique_account_id,
      password_digest: nil
    )
  end

  # 新しい生トークンを発行し、ダイジェストだけを保存して一度だけ呼び出し元へ返す
  def issue_authentication_token!
    raw_token = SecureRandom.urlsafe_base64(32)
    update!(authentication_token_digest: digest_authentication_token(raw_token))
    raw_token
  end

  # 渡された生トークンをダイジェスト化し、安全な方法で保存済みダイジェストと照合する
  def authentication_token_valid?(raw_token)
    return false unless raw_token.is_a?(String) && raw_token.present?
    return false if authentication_token_digest.blank?

    ActiveSupport::SecurityUtils.secure_compare(
      authentication_token_digest,
      digest_authentication_token(raw_token)
    )
  end

  # 保存済みダイジェストを削除し、それまでの認証トークンを無効にする
  def revoke_authentication_token!
    update!(authentication_token_digest: nil)
  end

  private

  # 生トークンをDB保存用の固定長SHA-256ダイジェストへ変換する
  def digest_authentication_token(raw_token)
    Digest::SHA256.hexdigest(raw_token)
  end

  class << self
    private

    # 既存IDとの重複を有限回だけ確認し、DBの一意制約へ渡す前の衝突を避ける
    def generate_unique_account_id
      ACCOUNT_ID_GENERATION_ATTEMPTS.times do
        candidate = generate_account_id_candidate
        return candidate unless exists?(login_id: candidate)
      end

      raise AccountIdGenerationError, "アカウントIDの生成上限を超えました"
    end

    # SecureRandomを使い、見間違いやすい文字を除いた許可文字だけで8文字を生成する
    def generate_account_id_candidate
      Array.new(ACCOUNT_ID_LENGTH) do
        index = SecureRandom.random_number(ACCOUNT_ID_CHARACTERS.length)
        ACCOUNT_ID_CHARACTERS[index]
      end.join
    end
  end
end
