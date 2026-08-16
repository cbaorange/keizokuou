require "securerandom"

class BattleSession < ApplicationRecord
  DIFFICULTIES = %w[super_weak weak normal hard super_hard].freeze
  RESULTS = %w[win lose].freeze

  belongs_to :user

  before_validation :assign_token, on: :create

  validates :token, presence: true, uniqueness: true
  validates :difficulty, inclusion: { in: DIFFICULTIES }
  validates :display_rate_before_battle,
            :display_rate_win_bonus,
            numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :completed, inclusion: { in: [true, false] }
  validates :result, inclusion: { in: RESULTS }, allow_nil: true
  validates :final_internal_rate,
            :final_display_rate,
            numericality: { only_integer: true, greater_than_or_equal_to: 0 },
            allow_nil: true
  validate :completed_result_is_consistent

  private

  # tokenには、ブラウザへ渡す推測困難な試合識別子を格納する。
  def assign_token
    self.token ||= SecureRandom.urlsafe_base64(32)
  end

  def completed_result_is_consistent
    if completed?
      errors.add(:result, "を指定してください") if result.nil?
      errors.add(:final_internal_rate, "を指定してください") if final_internal_rate.nil?
      errors.add(:final_display_rate, "を指定してください") if final_display_rate.nil?
    elsif result.present? || final_internal_rate.present? || final_display_rate.present?
      errors.add(:completed, "前に最終結果を保存できません")
    end
  end
end
