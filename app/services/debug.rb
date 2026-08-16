module Debug
  ENABLED = true

  # 本番環境でデバッグモードを切り忘れても、デバッグモードが自動でOFFになる。
  def self.enabled?
    ENABLED && !Rails.env.production?
  end
end

# trueでデバッグモードON
# debugフォルダは絶対に消すな。falseでもここのファイルを経由して日付などを取得している

# 日付をカスタム
# /tasks?date=2026-01-01

#デバッグ中のみログイン時のidフラッシュ表示
