FactoryBot.define do
  factory :battle_session do
    association :user
    sequence(:token) { |number| "battle-session-token-#{number}" }
    difficulty { "normal" }
    display_rate_before_battle { user.display_rate || 0 }
    display_rate_win_bonus { 0 }
    completed { false }
    result { nil }
    final_internal_rate { nil }
    final_display_rate { nil }
  end
end
