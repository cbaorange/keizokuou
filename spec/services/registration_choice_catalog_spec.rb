require "rails_helper"

RSpec.describe RegistrationChoiceCatalog do
  describe ".options" do
    it "shows the healing choice with the existing planned_action value" do
      planned_action = described_class.options.find do |option|
        option.fetch(:value) == "planned_action"
      end

      expect(planned_action).to eq(
        value: "planned_action",
        label: "癒されたい"
      )
    end
  end

  describe ".card_data_for!" do
    it "returns the YAML data used by the initial reward modal" do
      card_data = described_class.card_data_for!("new_challenge")

      expect(card_data).to include(
        "id" => 1,
        "name" => "かぐや姫",
        "image_tag_cards" => "cards/kaguya.PNG"
      )
      expect(card_data.fetch("first_get")).to be_present
    end

    it "returns Suibo Nyannyan for planned_action" do
      card_data = described_class.card_data_for!("planned_action")

      expect(card_data).to include(
        "id" => 3,
        "name" => "すいぼにゃんにゃん",
        "image_tag_cards" => "cards/suibo.PNG"
      )
    end
  end

  describe ".card_id_for!" do
    {
      "new_challenge" => 1,
      "strength_training" => 2,
      "planned_action" => 3,
      "new_ideas" => 4,
      "advice" => 5
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
        described_class.card_id_for!("new_challenge")
      }.to raise_error(RegistrationChoiceCatalog::SyukamonConfigurationError)
    end
  end
end
