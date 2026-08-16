class AddAuthenticationTokenDigestToUsers < ActiveRecord::Migration[7.0]
  def change
    # 生トークンを保存せず、SHA-256ダイジェストだけを保持する
    add_column :users, :authentication_token_digest, :string, limit: 64

    # 同じ認証トークンのダイジェストが複数ユーザーへ割り当てられることを防ぐ
    add_index :users, :authentication_token_digest, unique: true
  end
end
