class TasksController < ApplicationController
  ACQUISITION_EXP = 10

  class RewardDataError < StandardError; end

  def index
    @task_config = YAML.safe_load_file(
      Rails.root.join("config", "data", "task.yml")
    )
    @task_completions = current_user.task_completions
    @task_setup = flash[:task_setup]
    flash.delete(:task_setup)
    initial_card_reward_choice = flash[:initial_card_reward_choice]
    flash.delete(:initial_card_reward_choice)
    @initial_card_reward = build_initial_card_reward(
      initial_card_reward_choice
    )

    # ↓debug.rb内でfalseにすればパラメーターを無視するので、デプロイ時に書き換える必要なし
    # ↓3交替向けの日付変更時に次の10時までは前日とする処理はまだ終わっていないので注意すること。いつか作る
    @offset_date = OffsetDate.today(params)

    @today_completion = current_user.task_completions.find_by(
      completed_date: @offset_date
    )
    @syukamon_display = TaskSyukamonDisplay.new(
      user: current_user,
      offset_date: @offset_date
    ).call
    @calendar = TaskCalendar.new(
      user: current_user,
      offset_date: @offset_date
    ).call
    @nickname_to_store = flash[:nickname_to_store]
    flash.delete(:nickname_to_store)
  end

  def create
    completed_date = OffsetDate.today(params)

    if current_user.task_completions.exists?(completed_date: completed_date)
      return respond_already_completed
    end

    reward_result = nil

    ApplicationRecord.transaction do
      speaker = TaskSpeakerPicker.new(
        user_cards: current_user.user_cards,
        offset_date: completed_date,
        previous_speaker_card_id: previous_speaker_card_id(completed_date)
      ).call
      current_user.task_completions.create!(
        completed_date: completed_date,
        speaker_card_id: speaker.user_card.card_id
      )
      speaker.user_card.increment!(:next_dialogue_index)

      reward_result = create_card_reward(completed_date)
    end

    respond_task_completed(completed_date, reward_result)
  rescue ActiveRecord::RecordNotUnique
    respond_already_completed
  rescue StandardError => error
    Rails.logger.error(
      "タスク達成報酬の保存に失敗しました: #{error.class}: #{error.message}"
    )
    respond_reward_error
  end

  private

  def previous_speaker_card_id(completed_date)
    current_user.task_completions.find_by(
      completed_date: completed_date - 1.day
    )&.speaker_card_id
  end

  # 新規登録直後だけ、既存モーダルへ渡す初期カード表示データを組み立てる
  def build_initial_card_reward(registration_choice)
    return if registration_choice.blank?

    card_data = RegistrationChoiceCatalog.card_data_for!(registration_choice)

    unless current_user.user_cards.exists?(card_id: card_data.fetch("id"))
      return
    end

    {
      cardId: card_data.fetch("id"),
      isNew: true,
      title: "新しいカードを獲得しました！",
      cardName: card_data.fetch("name"),
      cardImagePath: view_context.asset_path(
        card_data.fetch("image_tag_cards")
      ),
      message: card_data["first_get"].to_s.strip,
      levelChange: nil,
      experienceSources: [],
      totalExperience: 0,
      showExperience: false
    }
  rescue RegistrationChoiceCatalog::InvalidChoiceError,
         RegistrationChoiceCatalog::SyukamonConfigurationError,
         KeyError => error
    Rails.logger.error(
      "初期カード報酬の表示データを作成できませんでした: " \
      "#{error.class}: #{error.message}"
    )
    nil
  end

  def create_card_reward(completed_date)
    syukamon_data = SyukamonCatalog.load!

    unless syukamon_data.is_a?(Hash)
      raise RewardDataError, "シュカモン設定が不正です"
    end

    cards_by_id = syukamon_data.values.index_by do |card_data|
      card_data["id"].to_i
    end
    weekday = completed_date.strftime("%a").downcase
    buff_card_ids = cards_by_id.values
      .select { |card_data| card_data["type"] == weekday }
      .map { |card_data| card_data["id"].to_i }
    buff_cards = current_user.user_cards.where(card_id: buff_card_ids).to_a

    level_up_card_id = Gacha.pull
    level_up_card_data = cards_by_id[level_up_card_id.to_i]

    if level_up_card_data.nil?
      raise RewardDataError, "抽選カードがシュカモン設定に存在しません"
    end

    level_up_card = current_user.user_cards.find_by(
      card_id: level_up_card_id
    )
    is_new = level_up_card.nil?
    level_up_card ||= current_user.user_cards.build(
      card_id: level_up_card_id,
      exp: 0
    )

    previous_exp = level_up_card.exp
    previous_level = Status.lv(level_up_card_id, previous_exp)
    streak_exp = Streak.calculate(current_user, completed_date)
    buff_breakdown = buff_cards.map do |buff_card|
      buff_card_data = cards_by_id[buff_card.card_id]

      if buff_card_data.nil?
        raise RewardDataError, "所有カードがシュカモン設定に存在しません"
      end

      {
        id: buff_card.card_id,
        name: buff_card_data.fetch("name"),
        exp: Status.exp_bonus(buff_card.card_id, buff_card.exp)
      }
    end
    buff_exp = buff_breakdown.sum { |buff| buff[:exp] }
    gained_exp = ACQUISITION_EXP + streak_exp + buff_exp

    level_up_card.exp = previous_exp + gained_exp
    level_up_card.save!

    current_level = Status.lv(level_up_card_id, level_up_card.exp)
    card_message_key = is_new ? "first_get" : "repeat_get"

    {
      card: {
        id: level_up_card_id,
        name: level_up_card_data.fetch("name"),
        image: view_context.asset_path(level_up_card_data.fetch("image_tag_cards")),
        message: level_up_card_data[card_message_key].to_s.strip,
        is_new: is_new,
        previous_exp: previous_exp,
        current_exp: level_up_card.exp,
        gained_exp: gained_exp,
        previous_level: previous_level,
        current_level: current_level,
        level_up: current_level > previous_level
      },
      exp_breakdown: {
        acquisition: ACQUISITION_EXP,
        streak: streak_exp,
        buffs: buff_breakdown
      }
    }
  end

  def respond_task_completed(completed_date, reward_result)
    respond_to do |format|
      format.html do
        flash[:notice] = "タスク達成！"
        redirect_to root_path
      end

      format.json do
        render json: {
          success: true,
          message: "タスク達成！",
          completed_date: completed_date.iso8601,
          card: reward_result[:card],
          exp_breakdown: reward_result[:exp_breakdown]
        }, status: :created
      end
    end
  end

  def respond_already_completed
    respond_to do |format|
      format.html do
        flash[:alert] = "今日はすでに達成済みです"
        redirect_to root_path
      end

      format.json do
        render json: {
          success: false,
          error_code: "already_completed",
          message: "今日はすでに達成済みです"
        }, status: :unprocessable_entity
      end
    end
  end

  def respond_reward_error
    respond_to do |format|
      format.html do
        flash[:alert] = "達成記録の保存に失敗しました"
        redirect_to root_path
      end

      format.json do
        render json: {
          success: false,
          error_code: "reward_processing_failed",
          message: "達成記録の保存に失敗しました"
        }, status: :unprocessable_entity
      end
    end
  end
end
