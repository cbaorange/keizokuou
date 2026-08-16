require "rails_helper"

RSpec.describe "Tasks", type: :request do
  before do
    reset!
    allow_any_instance_of(ActionView::Base).to receive(:stylesheet_link_tag).and_return("")
    allow_any_instance_of(ActionView::Base).to receive(:javascript_include_tag).and_return("")
  end

  def authentication_cookie_for(user)
    raw_token = user.issue_authentication_token!
    encrypted_cookie_jar = ActionDispatch::Request.new(
      Rails.application.env_config.dup
    ).cookie_jar

    encrypted_cookie_jar.encrypted[
      ApplicationController::AUTHENTICATION_COOKIE_NAME
    ] = {
      value: {
        user_id: user.id,
        raw_token: raw_token
      },
      expires: 1.year.from_now,
      httponly: true,
      same_site: :lax,
      secure: false,
      path: "/"
    }

    encrypted_cookie_jar.to_header
  end

  def post_tasks_as_json(user, completed_date)
    post "/tasks",
         params: {
           debug_date: completed_date.iso8601
         },
         headers: {
           "Cookie" => authentication_cookie_for(user)
         },
         as: :json
  end

  def parsed_response
    JSON.parse(response.body)
  end

  def create_user_with_speaker_card
    user = FactoryBot.create(:user)
    FactoryBot.create(:user_card, user: user, card_id: 7)
    user
  end

  describe "GET /tasks" do
    it "サイドバーのバトル操作で遷移せず、BattleSessionを作らない開始ポップアップを描画する" do
      user = create_user_with_speaker_card

      expect do
        get "/tasks", headers: { "Cookie" => authentication_cookie_for(user) }
      end.not_to change(BattleSession, :count)

      document = Nokogiri::HTML(response.body)
      launcher_button = document.at_css("[data-battle-launcher-open]")
      launcher = document.at_css("[data-battle-launcher]")
      launcher_data = JSON.parse(document.at_css("#battle-launcher-data").text)

      expect(launcher_button.name).to eq("button")
      expect(launcher_button["href"]).to be_nil
      expect(launcher.key?("hidden")).to be(true)
      launcher_start = launcher.at_css("[data-battle-launcher-start]")
      expect(launcher_start["href"]).to eq(battle_path)
      expect(launcher_start["data-battle-url"]).to eq(battle_path)
      expect(launcher_start["data-cards-url"]).to eq(cards_path)
      expect(launcher.at_css("[data-battle-launcher-close]").text.strip).to eq("閉じる")
      expect(launcher.css("[data-battle-launcher-close] svg")).to be_empty
      expect(launcher.at_css(".battle-launcher-modal__deck-heading").text.strip).to eq("デッキ")
      expect(launcher.css("[data-battle-launcher-slot]").size).to eq(5)
      expect(launcher.css("[data-battle-launcher-portrait]").size).to eq(5)
      expect(launcher.css("svg circle")).to be_empty
      expect(launcher_data.fetch("displayRate")).to eq(user.display_rate || 0)
      expect(launcher_data.fetch("ownedCardIds")).to eq([7])
    end

    it "空デッキの案内先であるcards表示ではBattleSessionを作らない" do
      user = create_user_with_speaker_card

      expect do
        get "/cards", headers: { "Cookie" => authentication_cookie_for(user) }
      end.not_to change(BattleSession, :count)

      expect(response).to have_http_status(:success)
    end

    it "returns http success" do
      user = create_user_with_speaker_card

      get "/tasks",
          headers: {
            "Cookie" => authentication_cookie_for(user)
          }

      expect(response).to have_http_status(:success)
    end

    it "renders the task completion overlay hidden initially" do
      user = create_user_with_speaker_card

      get "/tasks",
          headers: {
            "Cookie" => authentication_cookie_for(user)
          }

      expect(response.body).to match(
        /class="task-completion-lock"[^>]*hidden/
      )
      expect(response.body).to include("本日のタスクは達成済みです")
    end

    it "keeps the experience section available for normal card rewards" do
      user = create_user_with_speaker_card

      get "/tasks",
          headers: {
            "Cookie" => authentication_cookie_for(user)
          }

      document = Nokogiri::HTML(response.body)
      modal = document.at_css("[data-card-reward-modal]")
      experience = document.at_css("[data-card-reward-experience]")

      expect(modal["data-initial-card-reward"]).to be_nil
      expect(experience["hidden"]).to be_nil
      expect(experience.text).to include("経験値の内訳")
      expect(experience.text).to include("合計")
    end

    it "passes task.yml effects and the shared card-back DOM to JavaScript" do
      user = create_user_with_speaker_card

      get "/tasks",
          headers: {
            "Cookie" => authentication_cookie_for(user)
          }

      document = Nokogiri::HTML(response.body)
      task_config = JSON.parse(
        document.at_css("#task-effects-config").text
      )
      modal = document.at_css("[data-card-reward-modal]")

      expect(task_config.fetch("task_effects")).to eq(
        YAML.safe_load_file(
          Rails.root.join("config", "data", "task.yml")
        ).fetch("task_effects")
      )
      expect(modal.at_css("[data-card-reward-flipper]")).to be_present
      expect(modal.at_css("[data-card-reward-back-image]")["src"]).to include(
        "cards/card_back"
      )
      expect(modal.css("[data-card-reward-reveal]")).not_to be_empty
    end

    it "passes the selected owned Syukamon and dialogue state to JavaScript" do
      user = create_user_with_speaker_card

      get "/tasks",
          params: { debug_date: "2026-08-04" },
          headers: { "Cookie" => authentication_cookie_for(user) }

      document = Nokogiri::HTML(response.body)
      panel = document.at_css("[data-syukamon-panel]")
      message = document.at_css("[data-syukamon-message]")
      dialogues = JSON.parse(panel["data-dialogues"])

      expect(panel).to be_present
      expect(panel["data-card-id"]).to eq("7")
      expect(panel["data-syukamon-key"]).to eq("amaterasu")
      expect(panel["data-today-completed"]).to eq("false")
      expect(panel["data-previous-day-completed"]).to eq("false")
      expect(panel["data-has-prior-completion"]).to eq("false")
      expect(panel.at_css("h2").text).to eq("アマテラス")
      expect(panel.at_css("img")["src"]).to include("portraits/amaterasu")
      expect(dialogues.keys).to contain_exactly("todo", "done", "miss")
      expect(message.attributes).to have_key("hidden")
      expect(response.body).not_to include("シュカモン名")
      expect(response.body).not_to include(user.id.to_s + "</p>")
    end

    it "uses today's stored speaker even after another card is acquired" do
      user = create_user_with_speaker_card
      FactoryBot.create(:user_card, user: user, card_id: 1)
      FactoryBot.create(
        :task_completion,
        user: user,
        completed_date: Date.new(2026, 8, 4),
        speaker_card_id: 7
      )

      get "/tasks",
          params: { debug_date: "2026-08-04" },
          headers: { "Cookie" => authentication_cookie_for(user) }

      panel = Nokogiri::HTML(response.body).at_css("[data-syukamon-panel]")

      expect(panel["data-card-id"]).to eq("7")
      expect(panel["data-today-completed"]).to eq("true")
    end

    it "renders the backend calendar with 42 days and the current streak" do
      user = create_user_with_speaker_card
      offset_date = Date.new(2026, 8, 4)
      [offset_date - 2.days, offset_date - 1.day, offset_date].each do |date|
        FactoryBot.create(
          :task_completion,
          user: user,
          completed_date: date,
          speaker_card_id: 7
        )
      end

      get "/tasks",
          params: { debug_date: offset_date.iso8601 },
          headers: { "Cookie" => authentication_cookie_for(user) }

      document = Nokogiri::HTML(response.body)
      calendar = document.at_css("[data-calendar-panel]")
      weekdays = calendar.css(".calendar-panel__weekdays span").map(&:text)
      days = calendar.css("[data-calendar-day]")
      today = calendar.at_css("[data-calendar-today]")

      expect(weekdays).to eq(%w[月 火 水 木 金 土 日])
      expect(days.size).to eq(42)
      expect(days.first["data-date"]).to eq("2026-07-06")
      expect(days.last["data-date"]).to eq("2026-08-16")
      expect(days.slice(28, 7).map { |day| day["data-date"] }).to include("2026-08-04")
      expect(today["data-date"]).to eq("2026-08-04")
      expect(today["class"]).to include("calendar-panel__day--today")
      expect(today["class"]).to include("calendar-panel__day--completed")
      expect(calendar["data-today-completed"]).to eq("true")
      expect(calendar.at_css("[data-calendar-streak]").text).to eq("3")
      expect(days.map { |day| day.text.strip }).to all(match(/\A\d{1,2}\z/))
      expect(days).to all(satisfy { |day| !day["class"].split.include?("panel") })
      expect(response.body).not_to include("カレンダーは未接続です")
    end

    it "marks completed future dates and outside-month dates independently" do
      user = create_user_with_speaker_card
      offset_date = Date.new(2026, 8, 4)
      FactoryBot.create(
        :task_completion,
        user: user,
        completed_date: offset_date + 3.days,
        speaker_card_id: 7
      )

      get "/tasks",
          params: { debug_date: offset_date.iso8601 },
          headers: { "Cookie" => authentication_cookie_for(user) }

      calendar = Nokogiri::HTML(response.body).at_css("[data-calendar-panel]")
      future = calendar.at_css('[data-date="2026-08-07"]')
      previous_month = calendar.at_css('[data-date="2026-07-31"]')

      expect(future["class"]).to include("calendar-panel__day--completed")
      expect(future["class"]).not_to include("calendar-panel__day--outside-month")
      expect(previous_month["class"]).to include("calendar-panel__day--outside-month")
    end
  end

  describe "POST /tasks" do
    before do
      allow(Gacha).to receive(:pull).and_return(1)
    end

    it "creates a task completion and redirects for an HTML request" do
      user = create_user_with_speaker_card

      expect {
        post "/tasks",
             headers: {
               "Cookie" => authentication_cookie_for(user)
             }
      }.to change(TaskCompletion, :count).by(1)

      expect(response).to redirect_to(root_path)
      expect(flash[:notice]).to eq("タスク達成！")
    end

    it "stores the pre-reward speaker and increments its dialogue index once" do
      user = create_user_with_speaker_card
      speaker = user.user_cards.find_by!(card_id: 7)
      completed_date = Date.new(2026, 8, 4)
      allow(Gacha).to receive(:pull).and_return(1)

      expect {
        post_tasks_as_json(user, completed_date)
      }.to change { speaker.reload.next_dialogue_index }.from(0).to(1)

      completion = user.task_completions.find_by!(completed_date: completed_date)

      expect(completion.speaker_card_id).to eq(7)
      expect(user.user_cards.find_by(card_id: 1)).to be_present
      expect(completion.reload.speaker_card_id).to eq(7)
    end

    it "returns a new card and the basic experience breakdown" do
      user = create_user_with_speaker_card
      completed_date = Date.new(2026, 8, 4)

      expect(Gacha).to receive(:pull).once.and_return(1)

      expect {
        post_tasks_as_json(user, completed_date)
      }.to change(TaskCompletion, :count).by(1)
        .and change(UserCard, :count).by(1)

      body = parsed_response
      user_card = user.user_cards.find_by!(card_id: 1)

      expect(response).to have_http_status(:created)
      expect(user_card.exp).to eq(11)
      expect(body).to include(
        "success" => true,
        "message" => "タスク達成！",
        "completed_date" => "2026-08-04"
      )
      expect(body.fetch("card")).to include(
        "id" => 1,
        "name" => "かぐや姫",
        "is_new" => true,
        "previous_exp" => 0,
        "current_exp" => 11,
        "gained_exp" => 11,
        "previous_level" => 1,
        "current_level" => 1,
        "level_up" => false
      )
      expect(body.dig("card", "image")).to include("cards/kaguya")
      expect(body.dig("exp_breakdown", "acquisition")).to eq(10)
      expect(body.dig("exp_breakdown", "streak")).to eq(1)
      expect(body.dig("exp_breakdown", "buffs")).to eq([])
    end

    it "adds experience to an owned card" do
      user = create_user_with_speaker_card
      FactoryBot.create(:user_card, user: user, card_id: 1, exp: 20)

      post_tasks_as_json(user, Date.new(2026, 8, 4))

      card = parsed_response.fetch("card")

      expect(card).to include(
        "is_new" => false,
        "previous_exp" => 20,
        "current_exp" => 31,
        "gained_exp" => 11,
        "previous_level" => 2,
        "current_level" => 2,
        "level_up" => false
      )
    end

    it "includes the current day in streak experience" do
      user = create_user_with_speaker_card
      completed_date = Date.new(2026, 8, 4)
      FactoryBot.create(
        :task_completion,
        user: user,
        completed_date: completed_date - 2.days
      )
      FactoryBot.create(
        :task_completion,
        user: user,
        completed_date: completed_date - 1.day
      )

      post_tasks_as_json(user, completed_date)

      expect(parsed_response.dig("exp_breakdown", "streak")).to eq(3)
      expect(parsed_response.dig("card", "gained_exp")).to eq(13)
    end

    it "returns one weekday buff in the breakdown" do
      user = create_user_with_speaker_card
      FactoryBot.create(:user_card, user: user, card_id: 1, exp: 20)
      allow(Gacha).to receive(:pull).and_return(2)

      post_tasks_as_json(user, Date.new(2026, 8, 3))

      expect(parsed_response.dig("exp_breakdown", "buffs")).to eq(
        [
          {
            "id" => 1,
            "name" => "かぐや姫",
            "exp" => 6
          }
        ]
      )
      expect(parsed_response.dig("card", "gained_exp")).to eq(17)
    end

    it "adds every matching weekday buff" do
      user = create_user_with_speaker_card
      FactoryBot.create(:user_card, user: user, card_id: 1, exp: 20)
      FactoryBot.create(:user_card, user: user, card_id: 2, exp: 1)
      syukamon_data = YAML.safe_load_file(
        Rails.root.join("config", "data", "syukamon.yml")
      )
      syukamon_data.fetch("athena")["type"] = "mon"
      allow(YAML).to receive(:safe_load_file).and_return(syukamon_data)
      allow(Gacha).to receive(:pull).and_return(3)

      post_tasks_as_json(user, Date.new(2026, 8, 3))

      buffs = parsed_response.dig("exp_breakdown", "buffs")

      expect(buffs).to contain_exactly(
        {
          "id" => 1,
          "name" => "かぐや姫",
          "exp" => 6
        },
        {
          "id" => 2,
          "name" => "アテナ",
          "exp" => 3
        }
      )
      expect(parsed_response.dig("card", "gained_exp")).to eq(20)
    end

    it "returns a one-level increase" do
      user = create_user_with_speaker_card
      FactoryBot.create(:user_card, user: user, card_id: 1, exp: 19)

      post_tasks_as_json(user, Date.new(2026, 8, 4))

      expect(parsed_response.fetch("card")).to include(
        "previous_level" => 1,
        "current_level" => 2,
        "level_up" => true
      )
    end

    it "returns a multiple-level increase" do
      user = create_user_with_speaker_card
      FactoryBot.create(:user_card, user: user, card_id: 1, exp: 1)
      allow(Streak).to receive(:calculate).and_return(60)

      post_tasks_as_json(user, Date.new(2026, 8, 4))

      expect(parsed_response.fetch("card")).to include(
        "previous_level" => 1,
        "current_level" => 3,
        "level_up" => true
      )
    end

    it "does not create a duplicate completion for the same date" do
      user = create_user_with_speaker_card
      completed_date = Date.new(2026, 8, 4)
      FactoryBot.create(
        :task_completion,
        user: user,
        completed_date: completed_date
      )

      expect {
        post_tasks_as_json(user, completed_date)
      }.not_to change(TaskCompletion, :count)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(parsed_response).to include(
        "success" => false,
        "error_code" => "already_completed"
      )
      expect(Gacha).not_to have_received(:pull)
    end

    it "does not increment the speaker again when already completed" do
      user = create_user_with_speaker_card
      speaker = user.user_cards.find_by!(card_id: 7)
      completed_date = Date.new(2026, 8, 4)
      FactoryBot.create(
        :task_completion,
        user: user,
        completed_date: completed_date,
        speaker_card_id: 7
      )

      expect {
        post_tasks_as_json(user, completed_date)
      }.not_to change { speaker.reload.next_dialogue_index }
    end

    it "rolls back the completion when the gacha result is invalid" do
      user = create_user_with_speaker_card
      speaker = user.user_cards.find_by!(card_id: 7)
      allow(Gacha).to receive(:pull).and_return(999)
      previous_dialogue_index = speaker.next_dialogue_index

      expect {
        post_tasks_as_json(user, Date.new(2026, 8, 4))
      }.not_to change(TaskCompletion, :count)

      expect(speaker.reload.next_dialogue_index).to eq(previous_dialogue_index)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(parsed_response).to include(
        "success" => false,
        "error_code" => "reward_processing_failed"
      )
    end

    it "rolls back the completion when the card cannot be saved" do
      user = create_user_with_speaker_card
      allow_any_instance_of(UserCard).to receive(:save!).and_raise(
        ActiveRecord::RecordInvalid
      )

      expect {
        post_tasks_as_json(user, Date.new(2026, 8, 4))
      }.not_to change(TaskCompletion, :count)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(parsed_response.fetch("error_code")).to eq(
        "reward_processing_failed"
      )
    end
  end
end
