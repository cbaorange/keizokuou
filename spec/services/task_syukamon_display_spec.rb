require "rails_helper"

RSpec.describe TaskSyukamonDisplay do
  let(:user) { FactoryBot.create(:user) }
  let(:date) { Date.new(2026, 8, 4) }
  let!(:user_card) do
    FactoryBot.create(
      :user_card,
      user: user,
      card_id: 1,
      next_dialogue_index: 1
    )
  end

  it "uses the current index without updating it before completion" do
    display = described_class.new(user: user, offset_date: date).call

    expect(display).to include(
      card_id: 1,
      syukamon_key: "kaguya",
      name: "かぐや姫",
      image_tag_portraits: "portraits/kaguya.PNG",
      dialogue_index: 1,
      today_completed: false,
      previous_day_completed: false,
      has_prior_completion: false
    )
    expect(display.fetch(:dialogues).keys).to contain_exactly("todo", "done", "miss")
    expect(user_card.reload.next_dialogue_index).to eq(1)
  end

  it "uses the saved speaker and the pre-increment dialogue after completion" do
    user_card.update!(next_dialogue_index: 2)
    FactoryBot.create(
      :task_completion,
      user: user,
      completed_date: date,
      speaker_card_id: 1
    )

    display = described_class.new(user: user, offset_date: date).call

    expect(display[:card_id]).to eq(1)
    expect(display[:dialogue_index]).to eq(1)
    expect(display[:today_completed]).to be(true)
  end

  it "cycles the completed dialogue index to the last set when needed" do
    user_card.update!(next_dialogue_index: 0)
    FactoryBot.create(
      :task_completion,
      user: user,
      completed_date: date,
      speaker_card_id: 1
    )

    expect(described_class.new(user: user, offset_date: date).call[:dialogue_index]).to eq(1)
  end

  it "treats a previous nil speaker as no previous speaker" do
    FactoryBot.create(
      :task_completion,
      user: user,
      completed_date: date - 1.day,
      speaker_card_id: nil
    )

    display = described_class.new(user: user, offset_date: date).call

    expect(display[:previous_day_completed]).to be(true)
    expect(display[:card_id]).to eq(1)
  end

  it "does not count a future debug completion as prior history" do
    FactoryBot.create(
      :task_completion,
      user: user,
      completed_date: date + 1.day,
      speaker_card_id: 1
    )

    expect(described_class.new(user: user, offset_date: date).call[:has_prior_completion]).to be(false)
  end

  it "raises when today's stored speaker is nil" do
    completion = FactoryBot.create(
      :task_completion,
      user: user,
      completed_date: date,
      speaker_card_id: nil
    )

    expect {
      described_class.new(user: user, offset_date: date).call
    }.to raise_error(described_class::DisplayError, /id=#{completion.id}.*nil/)
  end
end
