require 'rails_helper'

RSpec.describe TaskCompletion, type: :model do
  # 達成記録が一人のユーザーに属する関連付けを確認する
  it "belongs to a user" do
    association = described_class.reflect_on_association(:user)

    expect(association.macro).to eq(:belongs_to)
    expect(association.class_name).to eq("User")
  end

  it "is valid with a user and completed date" do
    task_completion = FactoryBot.build(:task_completion)

    expect(task_completion).to be_valid
  end

  # ユーザーがない達成記録を弾けるか
  it "is invalid without a user" do
    task_completion = FactoryBot.build(:task_completion, user: nil)

    expect(task_completion).not_to be_valid
  end

  # 達成日が空欄の記録を弾けるか
  it "is invalid without a completed date" do
    task_completion = FactoryBot.build(:task_completion, completed_date: nil)

    expect(task_completion).not_to be_valid
  end

  # 同じユーザーの同じ日付への登録を防ぐ
  it "is invalid when the same user already has a completion on the same date" do
    user = FactoryBot.create(:user)

    FactoryBot.create(
      :task_completion,
      user: user,
      completed_date: Date.current
    )

    duplicate = FactoryBot.build(
      :task_completion,
      user: user,
      completed_date: Date.current
    )

    expect(duplicate).not_to be_valid
  end

  # 別のユーザーなら同じ日付でも保存できる
  it "is valid when another user has a completion on the same date" do
    FactoryBot.create(
      :task_completion,
      completed_date: Date.current
    )

    another_completion = FactoryBot.build(
      :task_completion,
      completed_date: Date.current
    )

    expect(another_completion).to be_valid
  end
end
