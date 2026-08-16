require "yaml"

module Status
  module_function

  SYUKAMON_PATH = Rails.root.join(
    "config",
    "data",
    "syukamon.yml"
  ).freeze

  def syukamon_data
    @syukamon_data ||= YAML.safe_load_file(SYUKAMON_PATH)
  end

  # シュカモンデータの取得として外部で使っても良い
  def self.card_data(id)
    syukamon_data.values.find do |card|
      card["id"].to_i == id.to_i
    end
  end

  def self.lv(id, exp)
    required = id < 6 ? 20 : 15

    level = 1

    while exp >= required
      exp -= required
      level += 1
      required += 20 # これで正しい。レアも要求expの伸び幅は20。違うのは要求expの初期値だけ。
  	end

    level
  end

  # 次のレベルまでに必要な経験値
  def self.exp_to_next_level(id, exp)
    required = id < 6 ? 20 : 15

    while exp >= required
      exp -= required
      required += 20 # これで正しい。レアも要求expの伸び幅は20。違うのは要求expの初期値だけ。
    end

    required - exp
  end

	# ボーナス経験値、カード獲得時などの内部処理用。タスクのページ向け
  def self.exp_bonus(id, exp)
    card = card_data(id)

		return 0 unless card

    card["exp_bonus_base"].to_i * lv(id, exp)
  end

	# ボーナス経験値の表示用。カードのページ向け
	def self.exp_bonus_text(id, exp)

		"カードを獲得したとき#{type_text(id)}曜日なら、\n追加で#{exp_bonus(id, exp)}expを与える"
	end


	# 内部計算用,これを参照することは想定していないが、必要に応じて利用可能
	def self.status_value(id, exp, base, grow)
		grow * (lv(id, exp) - 1) + base
	end

	# 攻撃のステータス計算
	def self.atk_value(id, exp)
		card = card_data(id)

		status_value(
			id,
			exp,
			card["attack_base"].to_i,
			card["attack_grow"].to_i
		)
	end

	# 体力のステータス計算
	def self.hp_value(id, exp)
		card = card_data(id)

		status_value(
			id,
			exp,
			card["health_base"].to_i,
			card["health_grow"].to_i
		)
	end

	# 速さ計算用
	def self.spd_value(id)
		card = card_data(id)

		card["speed"].to_i
	end

  # バフ説明文の生成。カード詳細で使う。
  # spdではexp・growを省略可能
  def self.buff_text(
    buff:,
    id: nil,
    exp: nil,
    base: nil,
    grow: nil
  )
    amount =
      if buff == "spd"
        base.to_i
      else
        status_value(id, exp, base, grow)
      end

    case buff
    when "spd"
      "味方が倒されるたびに\n速さが #{amount} 上がる。"
    when "atk"
      "味方が倒されるたびに\n攻撃が #{amount} 上がる。"
    when "hp"
      "味方が倒されるたびに\n体力が #{amount} 上がる。"
    else
      "-"
    end
  end

  # 属性の表示用
  def self.type_text(id)
		card = card_data(id)

    case card["type"]
    when "spd" then "+SPD"
    when "atk" then "+ATK"
    when "hp"  then "+HP"
    when "mon" then "月"
    when "tue" then "火"
    when "wed" then "水"
    when "thu" then "木"
    when "fri" then "金"
    when "sat" then "土"
    when "sun" then "日"
    else
      "-"
    end
  end

	# 出身地
	def self.birthplace(id)
		card = card_data(id)
		card["birthplace"]
	end
end
