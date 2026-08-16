class TaskSyukamonDisplay
  class DisplayError < StandardError; end

  def initialize(user:, offset_date:)
    @user = user
    @offset_date = offset_date
  end

  def call
    today_completion = completions.find_by(completed_date: @offset_date)
    previous_completion = completions.find_by(completed_date: @offset_date - 1.day)
    candidate = if today_completion
                  saved_candidate!(today_completion)
                else
                  TaskSpeakerPicker.new(
                    user_cards: @user.user_cards,
                    offset_date: @offset_date,
                    previous_speaker_card_id: previous_completion&.speaker_card_id
                  ).call
                end

    build_display(candidate, today_completion, previous_completion)
  end

  private

  def completions
    @completions ||= @user.task_completions
  end

  def saved_candidate!(today_completion)
    card_id = today_completion.speaker_card_id

    if card_id.nil?
      raise DisplayError,
            "本日のTaskCompletion id=#{today_completion.id} のspeaker_card_idがnilです"
    end

    user_card = @user.user_cards.find_by(card_id: card_id)

    unless user_card
      raise DisplayError,
            "本日の話者card_id=#{card_id}に対応する所有UserCardがありません"
    end

    syukamon_key, card_data = SyukamonCatalog.find_by_card_id!(card_id)
    TaskSpeakerPicker::Candidate.new(
      user_card: user_card,
      syukamon_key: syukamon_key,
      card_data: card_data
    )
  end

  def build_display(candidate, today_completion, previous_completion)
    dialogues = candidate.card_data.fetch("dialogues")
    index_offset = today_completion ? 1 : 0
    dialogue_index = (candidate.user_card.next_dialogue_index - index_offset) % dialogues.length
    dialogue = dialogues.fetch(dialogue_index)

    {
      card_id: candidate.user_card.card_id,
      syukamon_key: candidate.syukamon_key,
      name: candidate.card_data.fetch("name"),
      image_tag_portraits: candidate.card_data.fetch("image_tag_portraits"),
      dialogues: dialogue.slice("todo", "done", "miss"),
      dialogue_index: dialogue_index,
      today_completed: today_completion.present?,
      previous_day_completed: previous_completion.present?,
      has_prior_completion: completions.where("completed_date < ?", @offset_date).exists?
    }
  end
end
