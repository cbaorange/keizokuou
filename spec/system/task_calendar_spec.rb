require "rails_helper"

RSpec.describe "Task calendar", type: :system do
  around do |example|
    previous_setting = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    example.run
  ensure
    ActionController::Base.allow_forgery_protection = previous_setting
  end

  it "updates today's completion and streak once after the task API succeeds" do
    visit new_user_path

    fill_in "ニックネーム", with: "テスト"
    fill_in "継続すること", with: "カレンダーを確認する"
    choose "新しい挑戦を始めたい"
    click_button "新規登録して始める"

    expect(page).to have_css("[data-card-reward-modal]:not([hidden])")
    expect(find("[data-card-reward-close]", visible: :all)).to be_disabled
    page.execute_script(
      'document.querySelector("[data-card-reward-modal]").click()'
    )
    expect(page).to have_css("[data-card-reward-modal]:not([hidden])")
    expect(page).to have_css(
      "[data-card-reward-message]",
      text: "テスト様も、新たな一歩を踏み出しましたのね？",
      wait: 8
    )
    expect(find("[data-card-reward-message]").text).not_to include("【nick】")
    expect(find("[data-card-reward-message]").text).not_to include(" テスト ")
    expect(page).to have_css(
      "[data-card-reward-close]:not(:disabled)",
      wait: 8
    )
    find("[data-card-reward-close]").click

    user = User.order(:id).last
    user.user_cards.find_by!(card_id: 1).update!(next_dialogue_index: 1)
    refresh

    expect(page).to have_css(
      "[data-syukamon-message]",
      text: "テスト様の旅路に、光あれ！"
    )
    expect(find("[data-syukamon-message]").text).not_to include("【nick】")
    expect(find("[data-syukamon-message]").text).not_to include(" テスト ")

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
      "todayFontSize" => "19.2px",
      "normalFontSize" => "16px",
      "todayBackground" => "rgba(0, 0, 0, 0)",
      "todayBorderRadius" => "0px",
      "normalBorderWidth" => "0px",
      "todayCircleWidth" => "48.5938px",
      "todayCircleBorderWidth" => "1px",
      "todayCircleBorderColor" => "rgb(72, 168, 113)",
      "completedCircleWidth" => "38.3906px",
      "numberZIndex" => "3",
      "outerRingZIndex" => "2"
    )
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
    ).to eq("38.3906px")
    expect(
      page.evaluate_script(
        'getComputedStyle(document.querySelector("[data-calendar-today]"), "::before").backgroundColor'
      )
    ).to eq("rgb(72, 168, 113)")
    dialogue_while_modal_open = find("[data-syukamon-message]").text

    expect(page).to have_css(
      "[data-card-reward-close]:not(:disabled)",
      wait: 8
    )
    expect(find("[data-syukamon-message]").text).to eq(
      dialogue_while_modal_open
    )
    find("[data-card-reward-close]").click
    expect(page).to have_css(
      "[data-syukamon-message]",
      text: "テスト様、\nなんとも麗しい成果ですわね。"
    )
    refresh

    expect(find("[data-calendar-panel]")["data-today-completed"]).to eq("true")
    expect(find("[data-calendar-streak]").text).to eq("1")
    expect(find("[data-calendar-today]")[:class]).to include(
      "calendar-panel__day--completed"
    )
  end
end
