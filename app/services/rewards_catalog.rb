require "yaml"

class RewardsCatalog
  DATA_PATH = Rails.root.join("config", "data", "rewards.yml")
  FOLDER_KEYS = %w[slope_start_ratio tab_height_ratio height_ratio].freeze
  CONTENT_POPUP_FOLDER_KEYS = %w[slope_start_ratio tab_height_ratio].freeze
  CONTENT_TEXT_KEYS = %w[title body].freeze

  class ConfigurationError < StandardError; end

  def self.load!
    data = YAML.safe_load_file(DATA_PATH)

    unless data.is_a?(Hash)
      raise ConfigurationError, "報酬YAMLの最外部がHashではありません"
    end

    validate_folder!(data, "folder", FOLDER_KEYS)
    require_positive_number!(data.fetch("folder"), "folder", "height_ratio")
    validate_folder!(data, "content_popup_folder", CONTENT_POPUP_FOLDER_KEYS)
    validate_contents!(data["contents"])
    data
  end

  def self.validate_folder!(data, key, allowed_keys)
    folder = data[key]

    unless folder.is_a?(Hash)
      raise ConfigurationError, "rewards.ymlの#{key}はHashである必要があります"
    end

    unless folder.keys.sort == allowed_keys.sort
      raise ConfigurationError,
            "rewards.ymlの#{key}には#{allowed_keys.join(', ')}だけを設定してください"
    end

    slope_start_ratio = require_ratio!(folder, key, "slope_start_ratio")
    tab_height_ratio = require_ratio!(folder, key, "tab_height_ratio")

    unless slope_start_ratio >= 0 && slope_start_ratio < 1
      raise ConfigurationError, "#{key}.slope_start_ratioは0以上1未満である必要があります"
    end

    unless tab_height_ratio.positive? && tab_height_ratio < 1
      raise ConfigurationError, "#{key}.tab_height_ratioは0より大きく1未満である必要があります"
    end

    return if slope_start_ratio + tab_height_ratio <= 1

    raise ConfigurationError,
          "#{key}.slope_start_ratioと#{key}.tab_height_ratioの合計は1以下である必要があります"
  end
  private_class_method :validate_folder!

  def self.require_ratio!(folder, group_key, ratio_key)
    value = folder[ratio_key]
    return value.to_f if value.is_a?(Numeric)

    raise ConfigurationError, "#{group_key}.#{ratio_key}は数値である必要があります"
  end
  private_class_method :require_ratio!

  def self.require_positive_number!(folder, group_key, value_key)
    value = folder[value_key]
    return value.to_f if value.is_a?(Numeric) && value.positive?

    raise ConfigurationError,
          "#{group_key}.#{value_key}は0より大きい数値である必要があります"
  end
  private_class_method :require_positive_number!

  def self.validate_contents!(contents)
    unless contents.is_a?(Array)
      raise ConfigurationError, "rewards.ymlのcontentsは配列である必要があります"
    end

    contents.each_with_index do |content, index|
      unless content.is_a?(Hash)
        raise ConfigurationError, "contents[#{index}]はHashである必要があります"
      end

      CONTENT_TEXT_KEYS.each do |key|
        next if content[key].is_a?(String) && content[key].present?

        raise ConfigurationError, "contents[#{index}].#{key}がありません"
      end

      unless content.key?("required_rate")
        raise ConfigurationError, "contents[#{index}].required_rateがありません"
      end

      required_rate = content["required_rate"]
      next if required_rate.is_a?(Integer) && required_rate >= 0

      raise ConfigurationError,
            "contents[#{index}].required_rateは0以上の整数である必要があります"
    end
  end
  private_class_method :validate_contents!
end
