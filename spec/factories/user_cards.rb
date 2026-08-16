FactoryBot.define do
  factory :user_card do
    association :user
    card_id { 1 }
    exp { 1 }
  end
end
