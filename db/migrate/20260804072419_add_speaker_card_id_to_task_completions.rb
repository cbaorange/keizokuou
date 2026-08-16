class AddSpeakerCardIdToTaskCompletions < ActiveRecord::Migration[7.0]
  def change
    add_column :task_completions, :speaker_card_id, :integer
  end
end
