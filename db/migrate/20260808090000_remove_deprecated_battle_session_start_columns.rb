class RemoveDeprecatedBattleSessionStartColumns < ActiveRecord::Migration[7.0]
  def change
    remove_column :battle_sessions, :internal_rate_before_battle, :integer
    remove_column :battle_sessions, :start_rate_debit_applied, :boolean
    remove_column :battle_sessions, :start_rate_debit_amount, :integer
  end
end
