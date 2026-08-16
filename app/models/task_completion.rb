class TaskCompletion < ApplicationRecord
  # 達成記録は、必ず一人のユーザーに属する
  belongs_to :user

  # 達成日が空欄の記録を作れなくする
  validates :completed_date, presence: true

  # 同じユーザーは、同じ日に複数の達成記録をもてない
  validates :completed_date, uniqueness: { scope: :user_id }
end
