FactoryBot.define do
  factory :user do
    sequence(:login_id) { |number| "user_#{number}" }
    display_rate { 1 }
    internal_rate { 1 }
  end
end
