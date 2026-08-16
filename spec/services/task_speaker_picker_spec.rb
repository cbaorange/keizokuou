require "rails_helper"

RSpec.describe TaskSpeakerPicker do
  let(:user) { FactoryBot.create(:user) }
  let(:date) { Date.new(2026, 8, 4) }

  def card(card_id)
    FactoryBot.create(:user_card, user: user, card_id: card_id)
  end

  def picker(cards, previous: nil)
    described_class.new(
      user_cards: cards,
      offset_date: date,
      previous_speaker_card_id: previous
    )
  end

  it "returns the same card for the same input" do
    cards = [card(1), card(2), card(4)]

    expect(picker(cards).call.user_card.card_id).to eq(
      picker(cards).call.user_card.card_id
    )
  end

  it "normalizes candidates and the seed by card_id" do
    cards = [card(7), card(1), card(4)]
    first = picker(cards).tap(&:call)
    second = picker(cards.reverse).tap(&:call)

    expect(first.candidates.map { |candidate| candidate.user_card.card_id }).to eq([1, 4, 7])
    expect(first.seed).to eq(
      "syukamon-speaker-v1|date=2026-08-04|cards=1,4,7|previous=none"
    )
    expect(second.seed).to eq(first.seed)
    expect(second.call.user_card.card_id).to eq(first.call.user_card.card_id)
  end

  it "assigns the required normal and Tesla weights with a previous speaker" do
    result = picker([card(1), card(2), card(4)], previous: 1).tap(&:call)

    expect(result.candidates.to_h { |candidate| [candidate.syukamon_key, candidate.weight] }).to eq(
      "kaguya" => 1,
      "athena" => 10,
      "tesla" => 20
    )
  end

  it "doubles Tesla's previous-speaker weight" do
    result = picker([card(1), card(4)], previous: 4).tap(&:call)

    expect(result.candidates.to_h { |candidate| [candidate.syukamon_key, candidate.weight] }).to eq(
      "kaguya" => 10,
      "tesla" => 2
    )
  end

  it "uses weights 10 and 20 when there is no previous speaker" do
    result = picker([card(2), card(4)]).tap(&:call)

    expect(result.candidates.map(&:weight)).to eq([10, 20])
  end

  it "always returns the only owned card" do
    expect(picker([card(5)]).call.user_card.card_id).to eq(5)
  end

  it "uses rejection sampling values within each total weight" do
    cards = [card(1), card(2)]
    result = picker(cards).tap(&:call)
    tickets = 200.times.map do |number|
      result.instance_variable_set(:@seed, "ticket-test-#{number}")
      result.ticket_for(10)
    end

    expect(tickets).to all(be_between(0, 9))
    expect(tickets.uniq).to contain_exactly(*0..9)
  end

  it "raises an explicit error when the user owns no cards" do
    expect { picker([]).call }.to raise_error(
      described_class::SelectionError,
      /所有シュカモンが0件/
    )
  end
end
