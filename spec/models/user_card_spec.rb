require 'rails_helper'

RSpec.describe UserCard, type: :model do
  # 所持カード記録が一人のユーザーに属する関連付けを確認する
  it "belongs to a user" do
    association = described_class.reflect_on_association(:user)

    expect(association.macro).to eq(:belongs_to)
    expect(association.class_name).to eq("User")
  end

  # UserCardを正しく作れるか？
  it "is valid with a user, card id, and exp" do
    user_card = FactoryBot.build(:user_card)

    expect(user_card).to be_valid
  end

  # ユーザーがない所持カード記録を弾けるか
  it "is invalid without a user" do
    user_card = FactoryBot.build(:user_card, user: nil)

    expect(user_card).not_to be_valid
  end

  # カードIDが空欄の所持カード記録を弾けるか
  it "is invalid without a card id" do
    user_card = FactoryBot.build(:user_card, card_id: nil)

    expect(user_card).not_to be_valid
  end

  # 同じ組み合わせのカードとユーザーを弾く
  it "is invalid when the same user already has the same card" do
    user = FactoryBot.create(:user)

    FactoryBot.create(
      :user_card,
      user: user,
      card_id: 1
    )

    duplicate = FactoryBot.build(
      :user_card,
      user: user,
      card_id: 1
    )

    expect(duplicate).not_to be_valid
  end

  # 別のユーザーなら同じカードを持てる（カードが一人専用になっていないことの確認）
  it "is valid when another user has the same card" do
    FactoryBot.create(
      :user_card,
      card_id: 1
    )

    another_user_card = FactoryBot.build(
      :user_card,
      card_id: 1
    )

    expect(another_user_card).to be_valid
  end

  # 経験値が空欄の所持カード記録を弾けるか
  it "is invalid without exp" do
    user_card = FactoryBot.build(:user_card, exp: nil)

    expect(user_card).not_to be_valid
  end

  # 経験値に小数を指定した所持カード記録を弾けるか
  it "is invalid when exp is not an integer" do
    user_card = FactoryBot.build(:user_card, exp: 1.5)

    expect(user_card).not_to be_valid
  end

  # 経験値が1未満の所持カード記録を弾けるか
  it "is invalid when exp is less than one" do
    user_card = FactoryBot.build(:user_card, exp: 0)

    expect(user_card).not_to be_valid
  end
end
