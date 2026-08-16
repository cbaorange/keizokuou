require 'rails_helper'

RSpec.describe User, type: :model do
  # ユーザーが複数の達成記録を持つ関連付けを確認する
  it "has many task completions" do
    association = described_class.reflect_on_association(:task_completions)

    expect(association.macro).to eq(:has_many)
    expect(association.class_name).to eq("TaskCompletion")
  end

  # ユーザーが複数の所持カード記録を持つ関連付けを確認する
  it "has many user cards" do
    association = described_class.reflect_on_association(:user_cards)

    expect(association.macro).to eq(:has_many)
    expect(association.class_name).to eq("UserCard")
  end

  # login_idが入っている通常のユーザーは、有効か
  it "is valid with a login id" do
    user = FactoryBot.build(:user)

    expect(user).to be_valid
  end

  # login_idが空欄のユーザーを弾けるか
  it "is invalid without a login id" do
    user = FactoryBot.build(:user, login_id: nil)

    expect(user).not_to be_valid
  end

  # login_idの重複を弾けるか
  it "is invalid when the login id is already used" do
    FactoryBot.create(:user, login_id: "test_user")

    duplicate = FactoryBot.build(:user, login_id: "test_user")

    expect(duplicate).not_to be_valid
  end

  # パスワード未設定を許せるか
  it "is valid without a password digest" do
    user = FactoryBot.build(:user, password_digest: nil)

    expect(user).to be_valid
  end

  # パスワード設定済みの場合だけ正しい値を照合できるか
  it "authenticates a configured password" do
    user = FactoryBot.create(
      :user,
      password: "secure-password",
      password_confirmation: "secure-password"
    )

    expect(user.authenticate("secure-password")).to eq(user)
    expect(user.authenticate("incorrect")).to be(false)
  end

  describe ".build_for_registration" do
    # 登録用アカウントIDを仕様どおりの8文字で生成できるか
    it "builds a user with an eight-character account id" do
      user = described_class.build_for_registration

      expect(user.login_id.length).to eq(8)
    end

    # 許可文字だけを使い、見間違いやすい文字を含めず大文字で生成できるか
    it "uses only the allowed uppercase account id characters" do
      user = described_class.build_for_registration

      expect(user.login_id).to match(/\A[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}\z/)
      expect(user.login_id).not_to match(/[01ILO]/)
      expect(user.login_id).to eq(user.login_id.upcase)
    end

    # 複数回生成しても各IDが文字種と長さの仕様を満たすか
    it "builds specification-compliant account ids repeatedly" do
      account_ids = Array.new(20) { described_class.build_for_registration.login_id }

      expect(account_ids).to all(match(/\A[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}\z/))
    end

    # 予測可能な連番ではなくSecureRandomを生成元として利用するか
    it "uses SecureRandom to generate an account id" do
      expect(SecureRandom).to receive(:random_number).at_least(:once).and_call_original

      described_class.build_for_registration
    end

    # 最初の候補が既存IDと重複した場合に別の候補を生成し直せるか
    it "regenerates an account id after a duplicate candidate" do
      FactoryBot.create(:user, login_id: "22222222")
      random_numbers = Array.new(8, 0) + Array.new(8, 1)
      allow(SecureRandom).to receive(:random_number).and_return(*random_numbers)

      user = described_class.build_for_registration

      expect(user.login_id).to eq("33333333")
    end

    # 再生成した一意なIDで正常なUserを保存できるか
    it "builds a valid user after regenerating a duplicate account id" do
      FactoryBot.create(:user, login_id: "22222222")
      random_numbers = Array.new(8, 0) + Array.new(8, 1)
      allow(SecureRandom).to receive(:random_number).and_return(*random_numbers)

      user = described_class.build_for_registration

      expect(user.save).to be(true)
      expect(user.reload.login_id).to eq("33333333")
    end

    # 重複が上限まで続いた場合に通常のバリデーション失敗と異なる例外を返すか
    it "raises a dedicated error after reaching the retry limit" do
      FactoryBot.create(:user, login_id: "22222222")
      allow(SecureRandom).to receive(:random_number).and_return(0)

      expect {
        described_class.build_for_registration
      }.to raise_error(User::AccountIdGenerationError)
    end

    # 登録用ビルダーを呼ばない既存User更新ではlogin_idを変更しないか
    it "does not change an existing user account id on update" do
      user = FactoryBot.create(:user)
      original_login_id = user.login_id

      user.update!(display_rate: 2)

      expect(user.reload.login_id).to eq(original_login_id)
    end

    # 初回登録では引き継ぎ用パスコードを設定しないか
    it "builds a user without a password digest" do
      user = described_class.build_for_registration

      expect(user.password_digest).to be_nil
    end
  end

  describe "authentication token" do
    # 呼び出し元が認証に使う生トークンを受け取れるか
    it "issues a raw authentication token" do
      user = FactoryBot.create(:user)

      raw_token = user.issue_authentication_token!

      expect(raw_token).to be_a(String)
      expect(raw_token).not_to be_empty
    end

    # 発行時に固定長のダイジェストだけがDBへ保存されるか
    it "stores an authentication token digest when issuing a token" do
      user = FactoryBot.create(:user)

      raw_token = user.issue_authentication_token!

      expect(user.reload.authentication_token_digest).to eq(Digest::SHA256.hexdigest(raw_token))
    end

    # 漏えい時にそのまま認証へ使える生トークンがDBへ残らないか
    it "does not store the raw authentication token" do
      user = FactoryBot.create(:user)

      raw_token = user.issue_authentication_token!

      expect(user.reload.attributes.values).not_to include(raw_token)
    end

    # 発行された正しい生トークンで照合に成功するか
    it "accepts the issued authentication token" do
      user = FactoryBot.create(:user)
      raw_token = user.issue_authentication_token!

      expect(user.authentication_token_valid?(raw_token)).to be(true)
    end

    # 発行されたものとは異なるトークンで照合に失敗するか
    it "rejects an incorrect authentication token" do
      user = FactoryBot.create(:user)
      user.issue_authentication_token!

      expect(user.authentication_token_valid?("incorrect_token")).to be(false)
    end

    # nilを認証トークンとして受け付けないか
    it "rejects nil as an authentication token" do
      user = FactoryBot.create(:user)
      user.issue_authentication_token!

      expect(user.authentication_token_valid?(nil)).to be(false)
    end

    # 空文字列を認証トークンとして受け付けないか
    it "rejects an empty authentication token" do
      user = FactoryBot.create(:user)
      user.issue_authentication_token!

      expect(user.authentication_token_valid?("")).to be(false)
    end

    # ダイジェスト未発行のユーザーでは照合に成功しないか
    it "rejects a token when the digest is nil" do
      user = FactoryBot.create(:user, authentication_token_digest: nil)

      expect(user.authentication_token_valid?("token")).to be(false)
    end

    # ユーザーごとに推測困難な異なるトークンとダイジェストを発行できるか
    it "issues different tokens and digests for different users" do
      first_user = FactoryBot.create(:user)
      second_user = FactoryBot.create(:user)

      first_token = first_user.issue_authentication_token!
      second_token = second_user.issue_authentication_token!

      expect(first_token).not_to eq(second_token)
      expect(first_user.reload.authentication_token_digest)
        .not_to eq(second_user.reload.authentication_token_digest)
    end

    # 失効後に以前の生トークンを再利用できないか
    it "rejects the previous token after revocation" do
      user = FactoryBot.create(:user)
      raw_token = user.issue_authentication_token!

      user.revoke_authentication_token!

      expect(user.authentication_token_valid?(raw_token)).to be(false)
    end

    # 失効時に保存済みダイジェストがDBから削除されるか
    it "clears the authentication token digest when revoked" do
      user = FactoryBot.create(:user)
      user.issue_authentication_token!

      user.revoke_authentication_token!

      expect(user.reload.authentication_token_digest).to be_nil
    end
  end
end
