class UserCard < ApplicationRecord
  # ユーザーが空欄では作れなくする（重複はこれでは制約できない）
  belongs_to :user

  # カードIDを必須とし、同じユーザーと同じカードの重複登録を防ぐ
  validates :card_id, presence: true, uniqueness: { scope: :user_id }

  # 経験値の空欄、小数、0以下を登録できなくする
  validates :exp, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 1 }

  validates :next_dialogue_index,
            presence: true,
            numericality: { only_integer: true, greater_than_or_equal_to: 0 }
end
