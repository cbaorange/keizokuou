require "rails_helper"

RSpec.describe TaskCalendar do
  let(:user) { FactoryBot.create(:user) }

  def calendar(offset_date)
    described_class.new(user: user, offset_date: offset_date).call
  end

  shared_examples "a six-week Monday-first calendar" do |offset_date|
    it "builds 42 days with the current week in the fifth row for #{offset_date}" do
      result = calendar(offset_date)

      expect(result[:days].size).to eq(42)
      expect(result[:start_date].monday?).to be(true)
      expect(result[:end_date]).to eq(result[:start_date] + 41.days)
      expect(result[:days].slice(28, 7).map { |day| day[:date] }).to include(offset_date)
    end
  end

  include_examples "a six-week Monday-first calendar", Date.new(2026, 8, 3)
  include_examples "a six-week Monday-first calendar", Date.new(2026, 8, 9)
  include_examples "a six-week Monday-first calendar", Date.new(2024, 2, 29)
  include_examples "a six-week Monday-first calendar", Date.new(2026, 1, 1)

  it "marks completions by completed_date including future dates in the range" do
    offset_date = Date.new(2026, 8, 4)
    past = offset_date - 2.days
    future = offset_date + 3.days
    outside = offset_date + 30.days
    [past, future, outside].each do |date|
      FactoryBot.create(:task_completion, user: user, completed_date: date)
    end

    result = calendar(offset_date)
    completed_dates = result[:days].select { |day| day[:completed] }.map { |day| day[:date] }

    expect(completed_dates).to contain_exactly(past, future)
    expect(result[:days].find { |day| day[:date] == outside }).to be_nil
  end

  it "uses both month and year for the current-month state" do
    offset_date = Date.new(2026, 1, 1)
    result = calendar(offset_date)
    previous_year = result[:days].find { |day| day[:date] == Date.new(2025, 12, 31) }
    current_month_future = result[:days].find { |day| day[:date] == Date.new(2026, 1, 10) }

    expect(previous_year[:current_month]).to be(false)
    expect(current_month_future[:current_month]).to be(true)
    expect(
      described_class.new(user: user, offset_date: offset_date)
        .send(:current_month?, Date.new(2025, 1, 1))
    ).to be(false)
  end

  it "reuses Streak from today when today is completed" do
    offset_date = Date.new(2026, 8, 4)
    3.times do |days_ago|
      FactoryBot.create(:task_completion, user: user, completed_date: offset_date - days_ago.days)
    end

    expect(Streak).to receive(:calculate).with(user, offset_date).and_call_original
    expect(calendar(offset_date)[:current_streak]).to eq(3)
  end

  it "reuses Streak from yesterday when today is not completed" do
    offset_date = Date.new(2026, 8, 4)
    2.times do |days_ago|
      FactoryBot.create(
        :task_completion,
        user: user,
        completed_date: offset_date - (days_ago + 1).days
      )
    end

    expect(Streak).to receive(:calculate).with(user, offset_date - 1.day).and_call_original
    expect(calendar(offset_date)[:current_streak]).to eq(2)
  end

  it "returns zero when neither today nor yesterday is completed" do
    offset_date = Date.new(2026, 8, 4)
    FactoryBot.create(:task_completion, user: user, completed_date: offset_date - 2.days)

    expect(calendar(offset_date)[:current_streak]).to eq(0)
  end

  it "does not query task completions once per cell" do
    offset_date = Date.new(2026, 8, 4)
    queries = []
    callback = lambda do |_name, _start, _finish, _id, payload|
      sql = payload[:sql]
      queries << sql if sql.include?("task_completions") && sql.start_with?("SELECT")
    end

    ActiveSupport::Notifications.subscribed(callback, "sql.active_record") do
      calendar(offset_date)
    end

    expect(queries.size).to eq(2)
    expect(queries.count { |sql| sql.include?("BETWEEN") }).to eq(1)
  end
end
