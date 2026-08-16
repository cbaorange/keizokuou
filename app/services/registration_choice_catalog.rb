class RegistrationChoiceCatalog
  class InvalidChoiceError < StandardError; end
  class SyukamonConfigurationError < StandardError; end

  # フォームの内部値とYAML上のシュカモンを一か所で対応付ける
  CHOICES = {
    "new_challenge" => {
      label: "新しい挑戦を始めたい",
      syukamon_key: "kaguya",
      syukamon_name: "かぐや姫"
    },
    "strength_training" => {
      label: "筋トレを継続したい",
      syukamon_key: "athena",
      syukamon_name: "アテナ"
    },
    "planned_action" => {
      label: "癒されたい",
      syukamon_key: "suibo",
      syukamon_name: "すいぼにゃんにゃん"
    },
    "new_ideas" => {
      label: "新しいアイデアを生み出したい",
      syukamon_key: "tesla",
      syukamon_name: "ニコラ・テスラ"
    },
    "advice" => {
      label: "的確なアドバイスが欲しい",
      syukamon_key: "midas",
      syukamon_name: "ミダス"
    }
  }.freeze

  def self.options
    CHOICES.map do |value, choice|
      {
        value: value,
        label: choice.fetch(:label)
      }
    end
  end

  def self.card_id_for!(value)
    card_data_for!(value).fetch("id")
  end

  def self.card_data_for!(value)
    choice = CHOICES[value.to_s]

    unless choice
      raise InvalidChoiceError, "許可されていない選択値です"
    end

    syukamon_data = SyukamonCatalog.load!
    card_data = syukamon_data[choice.fetch(:syukamon_key)] if syukamon_data.is_a?(Hash)

    unless card_data.is_a?(Hash) &&
           card_data["name"] == choice.fetch(:syukamon_name) &&
           card_data["id"].is_a?(Integer) &&
           card_data["id"].positive?
      raise SyukamonConfigurationError, "選択肢に対応するシュカモンが設定に存在しません"
    end

    card_data
  rescue SyukamonCatalog::ConfigurationError => error
    raise SyukamonConfigurationError, error.message
  end
end
