class BattleRateValue
  class InvalidRateError < StandardError; end

  def self.normalize!(value, label)
    return 0 if value.nil?

    unless value.is_a?(Integer) && value >= 0
      raise InvalidRateError, "#{label}は0以上の整数である必要があります"
    end

    value
  end
end
