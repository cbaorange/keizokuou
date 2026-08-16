module Streak
    def self.calculate(user, completed_date)
		completion_dates = user.task_completions
			.where("completed_date <= ?", completed_date)
			.order(completed_date: :desc)
			.pluck(:completed_date)

		streak = 0
		expected_date = completed_date

		completion_dates.each do |date|
			break unless date == expected_date

			streak += 1
			expected_date -= 1.day
		end

		streak
    end
end