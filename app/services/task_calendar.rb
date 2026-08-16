require "set"

class TaskCalendar
  DAYS_COUNT = 42
  CURRENT_WEEK_ROW_OFFSET = 4.weeks

  def initialize(user:, offset_date:)
    @user = user
    @offset_date = offset_date
  end

  def call
    start_date = @offset_date.beginning_of_week(:monday) - CURRENT_WEEK_ROW_OFFSET
    end_date = start_date + (DAYS_COUNT - 1).days
    completed_dates = @user.task_completions
      .where(completed_date: start_date..end_date)
      .pluck(:completed_date)
      .to_set
    today_completed = completed_dates.include?(@offset_date)
    streak_date = today_completed ? @offset_date : @offset_date - 1.day

    {
      offset_date: @offset_date,
      start_date: start_date,
      end_date: end_date,
      today_completed: today_completed,
      current_streak: Streak.calculate(@user, streak_date),
      days: (start_date..end_date).map do |date|
        {
          date: date,
          day: date.day,
          today: date == @offset_date,
          current_month: current_month?(date),
          completed: completed_dates.include?(date)
        }
      end
    }
  end

  private

  def current_month?(date)
    date.year == @offset_date.year && date.month == @offset_date.month
  end
end
