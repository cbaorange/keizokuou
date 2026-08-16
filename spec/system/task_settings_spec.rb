require "rails_helper"

RSpec.describe "Task settings", type: :system do
  around do |example|
    previous_setting = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    example.run
  ensure
    ActionController::Base.allow_forgery_protection = previous_setting
  end

  def register_user
    visit new_user_path

    fill_in "ニックネーム", with: "設定テスト"
    fill_in "継続すること", with: "最初のタスク"
    choose "新しい挑戦を始めたい"
    click_button "新規登録して始める"

    expect(page).to have_css("[data-card-reward-modal]:not([hidden])")
    expect(page).to have_css(
      "[data-card-reward-close]:not(:disabled)",
      wait: 8
    )
    find("[data-card-reward-close]").click
  end

  def replace_task_storage(tasks)
    offset_date = find(".app-content[data-offset-date]")["data-offset-date"]
    saved_data = {
      updatedDate: offset_date,
      tasks: tasks
    }

    page.execute_script(
      "localStorage.setItem('keizokuou_daily_tasks', arguments[0])",
      saved_data.to_json
    )
    refresh
  end

  def saved_tasks
    JSON.parse(
      page.evaluate_script(
        "localStorage.getItem('keizokuou_daily_tasks')"
      )
    ).fetch("tasks")
  end

  it "cancels draft changes and saves all positions with compact display" do
    register_user
    replace_task_storage(
      "1" => {
        completed: true,
        job: "既存タスク1",
        description: "既存詳細1"
      },
      "2" => {
        completed: false,
        job: "",
        description: ""
      },
      "3" => {
        completed: true,
        job: "既存タスク3",
        description: "既存詳細3"
      }
    )

    expect(find("[data-task-settings-open]").text).to eq("＋")
    visible_tasks = all(".task-item[data-task-id]", visible: true)
    expect(visible_tasks.map { |task| task["data-task-id"] }).to eq(%w[1 3])
    expect(visible_tasks[0].native.rect.y).to be < visible_tasks[1].native.rect.y

    completed_task_style = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const task = document.querySelector('.task-item[data-task-id="1"]')
        const status = task.querySelector('.task-item__status')
        const check = status.querySelector('.task-item__check')

        return {
          backgroundImage: getComputedStyle(task).backgroundImage,
          statusText: status.textContent.trim(),
          checkHidden: check.hasAttribute('hidden'),
          checkColor: getComputedStyle(check).stroke,
          checkWidth: check.getBoundingClientRect().width,
          statusFontSize: Number.parseFloat(getComputedStyle(status).fontSize)
        }
      })()
    JAVASCRIPT

    expect(completed_task_style).to include(
      "statusText" => "",
      "checkHidden" => false,
      "checkColor" => "rgb(76, 203, 130)"
    )
    expect(completed_task_style.fetch("backgroundImage")).to include(
      "rgb(28, 28, 28) 0%",
      "rgb(41, 63, 50) 100%"
    )
    expect(completed_task_style.fetch("checkWidth")).to be_within(0.1).of(
      completed_task_style.fetch("statusFontSize")
    )

    initial_panel_height = find(".task-panel").native.rect.height
    initial_storage = page.evaluate_script(
      "localStorage.getItem('keizokuou_daily_tasks')"
    )

    find("[data-task-settings-open]").click
    expect(page).to have_css("[data-task-settings-modal]:not([hidden])")
    expect(
      all("[data-task-settings-job]", visible: :all).map(&:value)
    ).to eq(["既存タスク1", "", "既存タスク3"])

    layout = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const root = getComputedStyle(document.documentElement)
        const set = document.querySelector('[data-task-settings-position="1"]')
        const field = set.querySelector('.task-settings-modal__field')
        const label = field.querySelector('.task-settings-modal__label')
        const job = field.querySelector('[data-task-settings-job]')
        const deleteButton = field.querySelector('[data-task-settings-delete]')
        const deleteIcon = deleteButton.querySelector('svg')

        return {
          smallestSpace: root.getPropertyValue('--space-1').trim(),
          setGap: getComputedStyle(set).rowGap,
          fieldGap: getComputedStyle(field).rowGap,
          labelWeight: getComputedStyle(label).fontWeight,
          jobHeight: job.getBoundingClientRect().height,
          deleteHeight: deleteButton.getBoundingClientRect().height,
          deleteStrokeWidth: getComputedStyle(deleteIcon).strokeWidth
        }
      })()
    JAVASCRIPT

    expect(layout).to include(
      "smallestSpace" => "0.20rem",
      "setGap" => "8px",
      "fieldGap" => "3.2px",
      "labelWeight" => "540",
      "deleteStrokeWidth" => "1.4px"
    )
    expect(layout.fetch("deleteHeight")).to be <= layout.fetch("jobHeight")

    dismiss_confirm("削除しますか？") do
      find(
        '[data-task-settings-position="1"] [data-task-settings-delete]'
      ).click
    end
    expect(find("#task-settings-job-1").value).to eq("既存タスク1")
    expect(find("#task-settings-description-1").value).to eq("既存詳細1")

    accept_confirm("削除しますか？") do
      find(
        '[data-task-settings-position="1"] [data-task-settings-delete]'
      ).click
    end
    expect(find("#task-settings-job-1").value).to eq("")
    expect(find("#task-settings-description-1").value).to eq("")
    expect(
      page.evaluate_script(
        "localStorage.getItem('keizokuou_daily_tasks')"
      )
    ).to eq(initial_storage)

    page.execute_script(
      "document.querySelector('[data-task-settings-modal]').click()"
    )
    expect(page).to have_css("[data-task-settings-modal]:not([hidden])")

    page.execute_script(
      "document.querySelector('.task-settings-modal').scrollTop = 9999"
    )
    find("[data-task-settings-close]").click
    expect(page).to have_css("[data-task-settings-modal][hidden]", visible: :all)
    expect(
      page.evaluate_script(
        "localStorage.getItem('keizokuou_daily_tasks')"
      )
    ).to eq(initial_storage)
    expect(all(".task-item__title", visible: true).map(&:text)).to eq(
      ["既存タスク1", "既存タスク3"]
    )

    find("[data-task-settings-open]").click
    expect(
      page.evaluate_script(
        "document.querySelector('.task-settings-modal').scrollTop"
      )
    ).to eq(0)
    fill_in "task-settings-job-1", with: " 編集後タスク1 "
    fill_in "task-settings-description-1", with: "   "
    fill_in "task-settings-job-2", with: "   "
    fill_in "task-settings-description-2", with: " 新規詳細2 "
    accept_confirm("削除しますか？") do
      find(
        '[data-task-settings-position="3"] [data-task-settings-delete]'
      ).click
    end
    find("[data-task-settings-form]").click_button("OK")

    expect(page).to have_css("[data-task-settings-modal][hidden]", visible: :all)
    expect(saved_tasks).to eq(
      "1" => {
        "completed" => true,
        "job" => "編集後タスク1",
        "description" => ""
      },
      "2" => {
        "completed" => false,
        "job" => "タスク",
        "description" => "新規詳細2"
      },
      "3" => {
        "completed" => false,
        "job" => "",
        "description" => ""
      }
    )
    expect(all(".task-item__title", visible: true).map(&:text)).to eq(
      ["編集後タスク1", "タスク"]
    )
    expect(find(".task-panel").native.rect.height).to be_within(1).of(
      initial_panel_height
    )

    expect do
      accept_confirm do
        find('.task-item[data-task-id="2"]').click
      end
      expect(page).to have_css("[data-card-reward-modal]:not([hidden])")
    end.to change(TaskCompletion, :count).by(1)
  end

  it "submits completion when the only active task is completed" do
    register_user
    replace_task_storage(
      "1" => {
        completed: false,
        job: "1件だけのタスク",
        description: ""
      },
      "2" => { completed: false, job: "", description: "" },
      "3" => { completed: false, job: "", description: "" }
    )

    expect(all(".task-item[data-task-id]", visible: true).size).to eq(1)
    incomplete_status = find(
      '.task-item[data-task-id="1"] .task-item__status'
    )
    expect(incomplete_status.text).to eq("")
    expect(incomplete_status).to have_css(
      ".task-item__check[hidden]",
      visible: :all
    )

    expect do
      accept_confirm do
        find('.task-item[data-task-id="1"]').click
      end
      expect(page).to have_css("[data-card-reward-modal]:not([hidden])")
    end.to change(TaskCompletion, :count).by(1)
  end

  it "keeps a newly added task completed after today's completion" do
    register_user
    user = User.order(:id).last
    offset_date = Date.iso8601(
      find(".app-content[data-offset-date]")["data-offset-date"]
    )
    FactoryBot.create(
      :task_completion,
      user: user,
      completed_date: offset_date,
      speaker_card_id: user.user_cards.first.card_id
    )
    replace_task_storage(
      "1" => {
        completed: true,
        job: "達成済みタスク",
        description: ""
      },
      "2" => { completed: false, job: "", description: "" },
      "3" => { completed: false, job: "", description: "" }
    )

    expect(page).to have_css(".task-completion-lock:not([hidden])")
    completion_count = TaskCompletion.count

    find("[data-task-settings-open]").click
    fill_in "task-settings-job-2", with: "後から追加"
    find("[data-task-settings-form]").click_button("OK")

    expect(saved_tasks.fetch("2")).to eq(
      "completed" => true,
      "job" => "後から追加",
      "description" => ""
    )
    expect(TaskCompletion.count).to eq(completion_count)
    expect(page).to have_css(".task-completion-lock:not([hidden])")
    expect(find("[data-task-settings-open]")).to be_visible
  end

  it "does not submit completion when every position is empty" do
    register_user
    replace_task_storage(
      "1" => { completed: false, job: "", description: "" },
      "2" => { completed: false, job: "", description: "" },
      "3" => { completed: false, job: "", description: "" }
    )
    completion_count = TaskCompletion.count

    expect(all(".task-item[data-task-id]", visible: true)).to be_empty
    find("[data-task-settings-open]").click
    find("[data-task-settings-form]").click_button("OK")

    expect(TaskCompletion.count).to eq(completion_count)
    expect(page).to have_css(".task-completion-lock[hidden]", visible: :all)
  end
end
