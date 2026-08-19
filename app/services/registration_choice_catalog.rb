class RegistrationChoiceCatalog
  class InvalidChoiceError < StandardError; end
  class SyukamonConfigurationError < StandardError; end

  # 初期相棒として許可するカードIDとYAML上のシュカモンを一か所で対応付ける
  CHOICES = {
    "1" => {
      label: "新しい挑戦を始めたい",
      syukamon_key: "kaguya",
      syukamon_name: "かぐや姫"
    },
    "2" => {
      label: "筋トレを継続したい",
      syukamon_key: "athena",
      syukamon_name: "アテナ"
    },
    "3" => {
      label: "癒されたい",
      syukamon_key: "suibo",
      syukamon_name: "すいぼにゃんにゃん"
    },
    "4" => {
      label: "新しいアイデアを生み出したい",
      syukamon_key: "tesla",
      syukamon_name: "ニコラ・テスラ"
    },
    "5" => {
      label: "的確なアドバイスが欲しい",
      syukamon_key: "midas",
      syukamon_name: "ミダス"
    }
  }.freeze

  GUIDE_PARTNER_OVERRIDES = {
    "1" => { label: "新しい挑戦を始めた" },
    "2" => { label: "筋トレ大好き" },
    "3" => { label: "たくさん癒したい", name: "水母娘娘" },
    "4" => { label: "孤独の天才発明家", name: "テスラ" },
    "5" => { label: "怪しい情報屋" }
  }.freeze

  def self.options
    CHOICES.map do |value, choice|
      {
        value: value,
        label: choice.fetch(:label)
      }
    end
  end

  # ガイドでも登録処理と同じ許可リスト・YAML対応を使用する
  def self.partner_options
    CHOICES.map do |value, choice|
      card_data = card_data_for!(value)
      guide_copy = GUIDE_PARTNER_OVERRIDES.fetch(value, {})

      {
        value: value,
        label: guide_copy.fetch(:label, choice.fetch(:label)),
        card_id: card_data.fetch("id"),
        name: guide_copy.fetch(:name, card_data.fetch("name")),
        image_path: card_data.fetch("image_tag_portraits")
      }
    end
  end

  def self.valid_choice?(value)
    CHOICES.key?(value.to_s)
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
           card_data["id"] == value.to_i
      raise SyukamonConfigurationError, "選択肢に対応するシュカモンが設定に存在しません"
    end

    card_data
  rescue SyukamonCatalog::ConfigurationError => error
    raise SyukamonConfigurationError, error.message
  end
end
