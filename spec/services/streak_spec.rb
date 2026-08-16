require "rails_helper"

RSpec.describe Streak do
  describe ".calculate" do
    it "includes the specified completion date" do
      user = FactoryBot.create(:user)
      completed_date = Date.new(2026, 8, 4)

      3.times do |days_ago|
        FactoryBot.create(
          :task_completion,
          user: user,
          completed_date: completed_date - days_ago.days
        )
      end

      expect(described_class.calculate(user, completed_date)).to eq(3)
    end

    it "stops at the first missing date" do
      user = FactoryBot.create(:user)
      completed_date = Date.new(2026, 8, 4)
      FactoryBot.create(
        :task_completion,
        user: user,
        completed_date: completed_date
      )
      FactoryBot.create(
        :task_completion,
        user: user,
        completed_date: completed_date - 2.days
      )

      expect(described_class.calculate(user, completed_date)).to eq(1)
    end
  end
end
