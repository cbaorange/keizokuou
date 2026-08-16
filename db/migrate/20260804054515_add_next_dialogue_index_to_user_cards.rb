class AddNextDialogueIndexToUserCards < ActiveRecord::Migration[7.0]
  def change
    add_column :user_cards,
               :next_dialogue_index,
               :integer,
               default: 0,
               null: false
  end
end