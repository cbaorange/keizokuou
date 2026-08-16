class CreateBattleSessions < ActiveRecord::Migration[7.0]
  def change
    create_table :battle_sessions do |t|
      t.references :user, null: false, foreign_key: true
      t.string :token, null: false
      t.string :difficulty, null: false
      t.integer :internal_rate_before_battle, null: false, default: 0
      t.integer :display_rate_before_battle, null: false, default: 0
      t.integer :display_rate_win_bonus, null: false, default: 0
      t.boolean :start_rate_debit_applied, null: false, default: false
      t.integer :start_rate_debit_amount, null: false, default: 0
      t.boolean :completed, null: false, default: false
      t.string :result
      t.integer :final_internal_rate
      t.integer :final_display_rate

      t.timestamps
    end

    add_index :battle_sessions, :token, unique: true
  end
end
