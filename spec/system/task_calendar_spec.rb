require "rails_helper"

RSpec.describe "Task calendar", type: :system do
  around do |example|
    previous_setting = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    example.run
  ensure
    ActionController::Base.allow_forgery_protection = previous_setting
  end

  def wait_for_full_dialogue(message_selector:, measure_selector:)
    full_dialogue = find(
      "#{measure_selector}:not(:empty)",
      visible: :all
    ).text
    effects = page.evaluate_script(<<~JAVASCRIPT)
      JSON.parse(document.querySelector("#task-effects-config").textContent)
        .task_effects
    JAVASCRIPT
    typing_duration = [full_dialogue.each_char.count - 1, 0].max *
      effects.fetch("dialogue_typing").fetch("character_interval_ms")
    card_animation = effects.fetch("syukamon_get")
    animation_duration = card_animation.fetch("card_drop").fetch("duration_ms") +
      card_animation.fetch("card_flip").fetch("delay_ms") +
      card_animation.fetch("card_flip").fetch("duration_ms")
    wait_seconds = (typing_duration + animation_duration) / 1000.0 +
      Capybara.default_max_wait_time

    expect(page).to have_css(
      message_selector,
      text: full_dialogue,
      wait: wait_seconds
    )
    expect(find(message_selector).text).to eq(full_dialogue)

    full_dialogue
  end

  it "updates today's completion and streak once after the task API succeeds" do
    visit new_user_path(partner: "1")

    fill_in "ニックネーム", with: "テスト"
    fill_in "継続すること", with: "カレンダーを確認する"
    click_button "新規登録して始める"

    expect(page).to have_css("[data-card-reward-modal]:not([hidden])")
    expect(find("[data-card-reward-close]", visible: :all)).to be_disabled
    page.execute_script(
      'document.querySelector("[data-card-reward-modal]").click()'
    )
    expect(page).to have_css("[data-card-reward-modal]:not([hidden])")
    initial_reward_dialogue = wait_for_full_dialogue(
      message_selector: "[data-card-reward-message]",
      measure_selector: "[data-card-reward-modal] [data-dialogue-text-measure]"
    )
    expect(initial_reward_dialogue).to include("テスト")
    expect(initial_reward_dialogue).not_to include("【nick】")
    expect(page).to have_css(
      "[data-card-reward-close]:not(:disabled)",
      wait: 8
    )
    find("[data-card-reward-close]").click

    user = User.order(:id).last
    user.user_cards.find_by!(card_id: 1).update!(next_dialogue_index: 1)
    refresh

    todo_dialogue = wait_for_full_dialogue(
      message_selector: "[data-syukamon-message]",
      measure_selector: "[data-syukamon-panel] [data-dialogue-text-measure]"
    )
    expect(todo_dialogue).to include("テスト")
    expect(todo_dialogue).not_to include("【nick】")

    FactoryBot.create(
      :task_completion,
      user: user,
      completed_date: Date.current - 4.days,
      speaker_card_id: 1
    )
    FactoryBot.create(
      :task_completion,
      user: user,
      completed_date: Date.current + 3.days,
      speaker_card_id: 1
    )
    refresh

    calendar = find("[data-calendar-panel]")
    today = find("[data-calendar-today]")

    expect(all("[data-calendar-day]").size).to eq(42)
    expect(calendar["data-today-completed"]).to eq("false")
    expect(find("[data-calendar-streak]").text).to eq("0")
    expect(today[:class]).not_to include("calendar-panel__day--completed")
    expect(all(".calendar-panel__weekdays span").map(&:text)).to eq(%w[月 火 水 木 金 土 日])

    styles = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const today = document.querySelector("[data-calendar-today]")
        const normal = document.querySelector(
          "[data-calendar-day]:not(.calendar-panel__day--today):not(.calendar-panel__day--completed)"
        )
        const completed = document.querySelector(
          ".calendar-panel__day--completed:not(.calendar-panel__day--today)"
        )
        const number = today.querySelector(".calendar-panel__day-number")

        return {
          todayFontSize: getComputedStyle(today).fontSize,
          normalFontSize: getComputedStyle(normal).fontSize,
          todayBackground: getComputedStyle(today).backgroundColor,
          todayBorderRadius: getComputedStyle(today).borderRadius,
          normalBorderWidth: getComputedStyle(normal).borderWidth,
          todayCircleWidth: getComputedStyle(today, "::after").width,
          todayCircleBorderWidth: getComputedStyle(today, "::after").borderWidth,
          todayCircleBorderColor: getComputedStyle(today, "::after").borderColor,
          completedCircleWidth: getComputedStyle(completed, "::before").width,
          numberZIndex: getComputedStyle(number).zIndex,
          outerRingZIndex: getComputedStyle(today, "::after").zIndex
        }
      })()
    JAVASCRIPT

    expect(styles).to include(
      "todayBackground" => "rgba(0, 0, 0, 0)",
      "todayBorderRadius" => "0px",
      "normalBorderWidth" => "0px",
      "todayCircleBorderColor" => "rgb(72, 168, 113)"
    )
    expect(styles.fetch("todayFontSize").to_f)
      .to be > styles.fetch("normalFontSize").to_f
    expect(styles.fetch("todayCircleWidth").to_f)
      .to be > styles.fetch("completedCircleWidth").to_f
    expect(styles.fetch("todayCircleBorderWidth").to_f).to be_positive
    expect(styles.fetch("numberZIndex").to_i)
      .to be > styles.fetch("outerRingZIndex").to_i
    task_items = all(".task-item[data-task-id]", visible: true)
    expect(task_items.size).to eq(1)
    accept_confirm do
      task_items.first.click
    end

    expect(page).to have_css("[data-card-reward-modal]:not([hidden])")
    expect(find("[data-calendar-streak]").text).to eq("1")
    expect(find("[data-calendar-today]")[:class]).to include(
      "calendar-panel__day--completed"
    )
    expect(
      page.evaluate_script(
        'getComputedStyle(document.querySelector("[data-calendar-today]"), "::before").width'
      )
    ).to eq(styles.fetch("completedCircleWidth"))
    expect(
      page.evaluate_script(
        'getComputedStyle(document.querySelector("[data-calendar-today]"), "::before").backgroundColor'
      )
    ).to eq(styles.fetch("todayCircleBorderColor"))
    dialogue_while_modal_open = find("[data-syukamon-message]").text

    expect(page).to have_css(
      "[data-card-reward-close]:not(:disabled)",
      wait: 8
    )
    expect(find("[data-syukamon-message]").text).to eq(
      dialogue_while_modal_open
    )
    find("[data-card-reward-close]").click
    completed_dialogue = wait_for_full_dialogue(
      message_selector: "[data-syukamon-message]",
      measure_selector: "[data-syukamon-panel] [data-dialogue-text-measure]"
    )
    expect(completed_dialogue).to include("テスト")
    expect(completed_dialogue).not_to include("【nick】")
    refresh

    expect(find("[data-calendar-panel]")["data-today-completed"]).to eq("true")
    expect(find("[data-calendar-streak]").text).to eq("1")
    expect(find("[data-calendar-today]")[:class]).to include(
      "calendar-panel__day--completed"
    )
  end
end
