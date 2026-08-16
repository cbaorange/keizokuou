class CreateTaskCompletions < ActiveRecord::Migration[7.0]
  def change
    create_table :task_completions do |t|
      t.references :user, null: false, foreign_key: true
      t.date :completed_date, null: false

      t.timestamps
    end

    add_index :task_completions, [:user_id, :completed_date], unique: true
  end
end
