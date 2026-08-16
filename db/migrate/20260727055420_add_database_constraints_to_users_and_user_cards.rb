class AddDatabaseConstraintsToUsersAndUserCards < ActiveRecord::Migration[7.0]
  def change
    change_column_null :users, :login_id, false
    add_index :users, :login_id, unique: true

    change_column_null :user_cards, :card_id, false
    change_column_default :user_cards, :quantity, from: nil, to: 1
    change_column_null :user_cards, :quantity, false
  end
end