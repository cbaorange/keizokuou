require "yaml"

class SyukamonCatalog
  DATA_PATH = Rails.root.join("config", "data", "syukamon.yml")
  REQUIRED_DIALOGUE_TYPES = %w[todo done miss].freeze

  class ConfigurationError < StandardError; end

  def self.load!
    data = YAML.safe_load_file(DATA_PATH)

    unless data.is_a?(Hash)
      raise ConfigurationError, "シュカモンYAMLの最外部がHashではありません"
    end

    data
  end

  def self.find_by_card_id!(card_id, data: load!)
    syukamon_key, card_data = data.find do |_key, value|
      value.is_a?(Hash) && value["id"] == card_id
    end

    unless card_data
      raise ConfigurationError,
            "シュカモンYAMLにcard_id=#{card_id}のデータがありません"
    end

    validate!(syukamon_key, card_id, card_data)

    [syukamon_key, card_data]
  end

  def self.validate!(syukamon_key, card_id, card_data)
    %w[name image_tag_portraits dialogues].each do |field|
      if card_data[field].blank?
        raise ConfigurationError,
              "シュカモンYAML key=#{syukamon_key} card_id=#{card_id} に#{field}がありません"
      end
    end

    dialogues = card_data["dialogues"]

    unless dialogues.is_a?(Array) && dialogues.any?
      raise ConfigurationError,
            "シュカモンYAML key=#{syukamon_key} card_id=#{card_id} のdialoguesが空です"
    end

    dialogues.each_with_index do |dialogue, index|
      REQUIRED_DIALOGUE_TYPES.each do |type|
        next if dialogue.is_a?(Hash) && dialogue[type].present?

        raise ConfigurationError,
              "シュカモンYAML key=#{syukamon_key} card_id=#{card_id} " \
              "dialogues[#{index}] に#{type}がありません"
      end
    end
  end

  private_class_method :validate!
end
