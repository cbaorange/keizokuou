require "rails_helper"

RSpec.describe Status do
  describe ".lv" do
    it "calculates normal-card levels from 20 experience" do
      expect(described_class.lv(1, 19)).to eq(1)
      expect(described_class.lv(1, 20)).to eq(2)
      expect(described_class.lv(1, 60)).to eq(3)
    end

    it "calculates rare-card levels from 15 experience" do
      expect(described_class.lv(6, 14)).to eq(1)
      expect(described_class.lv(6, 15)).to eq(2)
      expect(described_class.lv(6, 50)).to eq(3)
    end

    it "supports multiple level increases" do
      expect(described_class.lv(1, 120)).to eq(4)
      expect(described_class.lv(6, 105)).to eq(4)
    end
  end

  describe ".exp_to_next_level" do
    it "calculates the remaining experience for a normal card" do
      expect(described_class.exp_to_next_level(1, 0)).to eq(20)
      expect(described_class.exp_to_next_level(1, 19)).to eq(1)
      expect(described_class.exp_to_next_level(1, 20)).to eq(40)
      expect(described_class.exp_to_next_level(1, 59)).to eq(1)
    end

    it "calculates the remaining experience for a rare card" do
      expect(described_class.exp_to_next_level(6, 14)).to eq(1)
      expect(described_class.exp_to_next_level(6, 15)).to eq(35)
    end
  end

  describe ".exp_bonus" do
    it "multiplies the YAML base by the card level" do
      expect(described_class.exp_bonus(1, 20)).to eq(6)
    end

    it "returns zero when exp_bonus_base is missing" do
      allow(YAML).to receive(:safe_load_file).and_return(
        "sample" => {
          "id" => 99
        }
      )

      expect(described_class.exp_bonus(99, 1)).to eq(0)
    end

    it "returns zero when the card is missing from YAML" do
      expect(described_class.exp_bonus(999, 1)).to eq(0)
    end
  end
end
