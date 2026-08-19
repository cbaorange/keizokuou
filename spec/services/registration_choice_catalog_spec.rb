require "rails_helper"

RSpec.describe RegistrationChoiceCatalog do
  describe ".options" do
    it "shows the healing choice with card id 3" do
      healing_choice = described_class.options.find do |option|
        option.fetch(:value) == "3"
      end

      expect(healing_choice).to eq(
        value: "3",
        label: "癒されたい"
      )
    end

    it "keeps the registration labels separate from the guide copy" do
      expect(described_class.options.map { |option| option.fetch(:label) }).to eq([
        "新しい挑戦を始めたい",
        "筋トレを継続したい",
        "癒されたい",
        "新しいアイデアを生み出したい",
        "的確なアドバイスが欲しい"
      ])
    end
  end

  describe ".card_data_for!" do
    it "returns the YAML data used by the initial reward modal" do
      card_data = described_class.card_data_for!("1")

      expect(card_data).to include(
        "id" => 1,
        "name" => "かぐや姫",
        "image_tag_cards" => "cards/kaguya.PNG"
      )
      expect(card_data.fetch("first_get")).to be_present
    end

    it "returns Suibo Nyannyan for card id 3" do
      card_data = described_class.card_data_for!("3")

      expect(card_data).to include(
        "id" => 3,
        "name" => "すいぼにゃんにゃん",
        "image_tag_cards" => "cards/suibo.PNG"
      )
    end
  end

  describe ".card_id_for!" do
    {
      "1" => 1,
      "2" => 2,
      "3" => 3,
      "4" => 4,
      "5" => 5
    }.each do |choice, expected_card_id|
      it "resolves #{choice} from the syukamon YAML" do
        expect(described_class.card_id_for!(choice)).to eq(expected_card_id)
      end
    end

    it "rejects a value outside the managed choices" do
      expect {
        described_class.card_id_for!("unknown")
      }.to raise_error(RegistrationChoiceCatalog::InvalidChoiceError)
    end

    it "rejects a managed choice when its YAML card is missing" do
      allow(YAML).to receive(:safe_load_file).and_return({})

      expect {
        described_class.card_id_for!("1")
      }.to raise_error(RegistrationChoiceCatalog::SyukamonConfigurationError)
    end
  end


  describe ".partner_options" do
    it "returns the managed five partners with guide copy, ids, and portrait images" do
      expect(described_class.partner_options).to eq([
        {
          value: "1",
          label: "新しい挑戦を始めた",
          card_id: 1,
          name: "かぐや姫",
          image_path: "portraits/kaguya.PNG"
        },
        {
          value: "2",
          label: "筋トレ大好き",
          card_id: 2,
          name: "アテナ",
          image_path: "portraits/athena.PNG"
        },
        {
          value: "3",
          label: "たくさん癒したい",
          card_id: 3,
          name: "水母娘娘",
          image_path: "portraits/suibo.PNG"
        },
        {
          value: "4",
          label: "孤独の天才発明家",
          card_id: 4,
          name: "テスラ",
          image_path: "portraits/tesla.PNG"
        },
        {
          value: "5",
          label: "怪しい情報屋",
          card_id: 5,
          name: "ミダス",
          image_path: "portraits/midas.PNG"
        }
      ])
    end
  end

  describe ".valid_choice?" do
    it "accepts only the managed string values" do
      expect(described_class.valid_choice?("1")).to be(true)
      expect(described_class.valid_choice?("5")).to be(true)
      expect(described_class.valid_choice?("6")).to be(false)
      expect(described_class.valid_choice?("new_challenge")).to be(false)
      expect(described_class.valid_choice?(nil)).to be(false)
    end
  end
end
