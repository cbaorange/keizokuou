require "yaml"

module Gacha
  def self.pull
    syukamon_path = Rails.root.join("config", "data", "syukamon.yml")
    syukamon_data = YAML.safe_load_file(syukamon_path)
    lottery = []

    syukamon_data.values.each do |card|
      card_id = card["id"].to_i
      ticket_count = card_id < 6 ? 4 : 1

      ticket_count.times { lottery << card_id }
    end

    raise "抽選対象のシュカモンがありません" if lottery.empty?

    lottery.sample
  end
end
