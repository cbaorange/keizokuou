require "rails_helper"

RSpec.describe SyukamonCatalog do
  it "returns a validated YAML key and card data" do
    key, data = described_class.find_by_card_id!(4)

    expect(key).to eq("tesla")
    expect(data).to include(
      "name" => "ニコラ・テスラ",
      "image_tag_portraits" => "portraits/tesla.PNG"
    )
  end

  it "reports the key, card_id, dialogue index, and missing field" do
    data = {
      "broken" => {
        "id" => 9,
        "name" => "不完全",
        "image_tag_portraits" => "portraits/broken.PNG",
        "dialogues" => [{ "todo" => "todo", "done" => "done" }]
      }
    }

    expect {
      described_class.find_by_card_id!(9, data: data)
    }.to raise_error(
      described_class::ConfigurationError,
      /key=broken card_id=9 dialogues\[0\].*miss/
    )
  end
end
