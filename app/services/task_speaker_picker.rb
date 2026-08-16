require "digest"

class TaskSpeakerPicker
  TESLA_KEY = "tesla"
  NORMAL_WEIGHT = 10
  PREVIOUS_WEIGHT = 1
  UINT64_RANGE = 2**64

  class SelectionError < StandardError; end

  Candidate = Struct.new(
    :user_card,
    :syukamon_key,
    :card_data,
    :weight,
    keyword_init: true
  )

  attr_reader :seed, :candidates

  def initialize(user_cards:, offset_date:, previous_speaker_card_id: nil,
                 syukamon_data: SyukamonCatalog.load!)
    @user_cards = user_cards.to_a.sort_by(&:card_id)
    @offset_date = offset_date
    @previous_speaker_card_id = previous_speaker_card_id
    @syukamon_data = syukamon_data
  end

  def call
    if @user_cards.empty?
      raise SelectionError, "話者抽選対象の所有シュカモンが0件です"
    end

    @candidates = @user_cards.map { |user_card| build_candidate(user_card) }
    @seed = build_seed
    ticket = ticket_for(@candidates.sum(&:weight))
    cumulative_weight = 0

    @candidates.find do |candidate|
      cumulative_weight += candidate.weight
      ticket < cumulative_weight
    end
  end

  def ticket_for(total_weight)
    raise ArgumentError, "合計重みは1以上である必要があります" unless total_weight.positive?

    limit = UINT64_RANGE - (UINT64_RANGE % total_weight)
    nonce = 0

    loop do
      digest = Digest::SHA256.digest("#{@seed}|nonce=#{nonce}")
      value = digest.byteslice(0, 8).unpack1("Q>")
      return value % total_weight if value < limit

      nonce += 1
    end
  end

  private

  def build_candidate(user_card)
    syukamon_key, card_data = SyukamonCatalog.find_by_card_id!(
      user_card.card_id,
      data: @syukamon_data
    )
    weight = user_card.card_id == @previous_speaker_card_id ? PREVIOUS_WEIGHT : NORMAL_WEIGHT
    weight *= 2 if syukamon_key == TESLA_KEY

    Candidate.new(
      user_card: user_card,
      syukamon_key: syukamon_key,
      card_data: card_data,
      weight: weight
    )
  end

  def build_seed
    previous = @previous_speaker_card_id || "none"
    card_ids = @user_cards.map(&:card_id).join(",")

    "syukamon-speaker-v1|date=#{@offset_date.iso8601}|" \
      "cards=#{card_ids}|previous=#{previous}"
  end
end
