class BattleRules
  DIFFICULTIES = BattleSession::DIFFICULTIES
  RATIO_TOLERANCE = 1e-9

  class ConfigurationError < StandardError; end

  def self.load!
    new(YAML.safe_load_file(Rails.root.join("config", "data", "battle.yml")))
  end

  def initialize(config)
    @config = require_hash(config, "battle.yml")
    validate!
  end

  def select_cpu_difficulty(display_rate, random_value:)
    display_rate = BattleRateValue.normalize!(display_rate, "表示レート")
    require_random_value(random_value)

    difficulty = @config.fetch("cpu").fetch("difficulty")
    normal_min = difficulty.fetch("normal_min_display_rate")
    hard_min = difficulty.fetch("hard_min_display_rate")

    if display_rate < normal_min
      candidates = %w[super_weak weak]
      return candidates[(random_value * candidates.length).floor]
    end

    if display_rate < hard_min
      candidates = %w[super_weak weak normal]
      return candidates[(random_value * candidates.length).floor]
    end

    candidates = %w[weak normal hard super_hard]
    ratios = high_rate_ratios(difficulty)
    cumulative_ratio = 0.0

    candidates.each_with_index do |candidate, index|
      cumulative_ratio += ratios[index]
      return candidate if random_value < cumulative_ratio
    end

    candidates.last
  end

  def rates_for(difficulty)
    unless DIFFICULTIES.include?(difficulty)
      raise ConfigurationError, "未対応のCPU難易度です: #{difficulty.inspect}"
    end

    @config.fetch("internal_rate").fetch("difficulty").fetch(difficulty)
  end

  def battle_start_change
    @config.fetch("internal_rate").fetch("battle_start_change")
  end

  def battle_area_card_padding_px
    @config.fetch("battle_area").fetch("card_padding_px")
  end

  def battle_area_border_radius_ratio
    @config.fetch("battle_area").fetch("border_radius_ratio")
  end

  def display_rate_win_bonus_max
    @config.fetch("display_rate").fetch("win_random_bonus_max")
  end

  private

  def validate!
    battle_area = require_hash(@config["battle_area"], "battle_area")
    require_nonnegative_number(
      battle_area["card_padding_px"],
      "battle_area.card_padding_px"
    )
    require_nonnegative_number(
      battle_area["border_radius_ratio"],
      "battle_area.border_radius_ratio"
    )

    cpu = require_hash(@config["cpu"], "cpu")
    difficulty = require_hash(cpu["difficulty"], "cpu.difficulty")
    normal_min = require_nonnegative_integer(
      difficulty["normal_min_display_rate"],
      "cpu.difficulty.normal_min_display_rate"
    )
    hard_min = require_nonnegative_integer(
      difficulty["hard_min_display_rate"],
      "cpu.difficulty.hard_min_display_rate"
    )
    if normal_min >= hard_min
      raise ConfigurationError,
            "cpu.difficulty.normal_min_display_rateはhard_min_display_rate未満である必要があります"
    end

    ratios = high_rate_ratios(difficulty)
    if (ratios.sum - 1.0).abs > RATIO_TOLERANCE
      raise ConfigurationError, "cpu.difficulty.high_rate_selectionの比率合計は1.0である必要があります"
    end

    level = require_hash(cpu["level"], "cpu.level")
    divisor = level["internal_rate_divisor"]
    unless divisor.is_a?(Numeric) && divisor.positive?
      raise ConfigurationError, "cpu.level.internal_rate_divisorは0より大きい数である必要があります"
    end

    internal_rate = require_hash(@config["internal_rate"], "internal_rate")
    require_nonpositive_integer(
      internal_rate["battle_start_change"],
      "internal_rate.battle_start_change"
    )
    rate_difficulties = require_hash(internal_rate["difficulty"], "internal_rate.difficulty")
    DIFFICULTIES.each do |name|
      rates = require_hash(rate_difficulties[name], "internal_rate.difficulty.#{name}")
      require_nonnegative_integer(rates["win_gain"], "internal_rate.difficulty.#{name}.win_gain")
      require_nonpositive_integer(
        rates["lose_decrease"],
        "internal_rate.difficulty.#{name}.lose_decrease"
      )
    end

    display_rate = require_hash(@config["display_rate"], "display_rate")
    require_nonnegative_integer(
      display_rate["win_random_bonus_max"],
      "display_rate.win_random_bonus_max"
    )
  rescue KeyError => error
    raise ConfigurationError, "battle.ymlの必須設定がありません: #{error.message}"
  end

  def high_rate_ratios(difficulty)
    selection = require_hash(
      difficulty["high_rate_selection"],
      "cpu.difficulty.high_rate_selection"
    )
    %w[weak normal hard super_hard].map do |name|
      ratio = selection["#{name}_ratio"]
      unless ratio.is_a?(Numeric) && ratio >= 0
        raise ConfigurationError,
              "cpu.difficulty.high_rate_selection.#{name}_ratioは0以上の数である必要があります"
      end
      ratio.to_f
    end
  end

  def require_hash(value, label)
    return value if value.is_a?(Hash)

    raise ConfigurationError, "#{label}はオブジェクトである必要があります"
  end

  def require_nonnegative_integer(value, label)
    return value if value.is_a?(Integer) && value >= 0

    raise ConfigurationError, "#{label}は0以上の整数である必要があります"
  end

  def require_nonnegative_number(value, label)
    return value if value.is_a?(Numeric) && value.finite? && value >= 0

    raise ConfigurationError, "#{label}は0以上の有限数である必要があります"
  end

  def require_nonpositive_integer(value, label)
    return value if value.is_a?(Integer) && value <= 0

    raise ConfigurationError, "#{label}は0以下の整数である必要があります"
  end

  def require_random_value(value)
    return if value.is_a?(Numeric) && value >= 0 && value < 1

    raise ArgumentError, "CPU難易度抽選値は0以上1未満である必要があります"
  end
end
