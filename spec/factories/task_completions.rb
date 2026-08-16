FactoryBot.define do
  factory :task_completion do
    association :user
    completed_date { Date.current }
  end
end
