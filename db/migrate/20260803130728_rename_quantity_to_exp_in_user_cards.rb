class RenameQuantityToExpInUserCards < ActiveRecord::Migration[7.0]
  def change
    rename_column :user_cards, :quantity, :exp
  end
end
