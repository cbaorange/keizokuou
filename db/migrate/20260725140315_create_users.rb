class CreateUsers < ActiveRecord::Migration[7.0]
  def change
    create_table :users do |t|
      t.string :login_id
      t.string :password_digest
      t.integer :display_rate
      t.integer :internal_rate

      t.timestamps
    end
  end
end
