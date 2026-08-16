import test, { describe } from "node:test"
import assert from "node:assert/strict"

import {
  applyRareLevelAdjustment,
  buildCpuDeck,
  buildHardDeck,
  buildNormalDeck,
  buildSuperHardDeck,
  buildSuperWeakDeck,
  buildWeakDeck,
  calculateBaseLevel,
  createCpuDeck,
  createRentalCard,
  createRentalCards,
  selectCpuDifficulty,
  selectRandomLevel
} from "../../../app/javascript/battle_cpu_deck.js"
import { selectRandomCpuCard } from "../../../app/javascript/battle_cpu_ai.js"

test("複数レンタル生成APIが公開されている", () => {
  assert.equal(typeof createRentalCards, "function")
})

// 実際のsyukamon.ymlと同じ名前キールートで7体分のテストデータを作る
function createSyukamonData() {
  const cards = {}
  const names = ["kaguya", "athena", "suibo", "tesla", "midas", "rex", "amaterasu"]
  const types = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

  for (let index = 0; index < names.length; index += 1) {
    const id = index + 1
    cards[names[index]] = {
      id,
      type: types[index],
      health_base: 100 + id,
      health_grow: 10,
      attack_base: 40 + id,
      attack_grow: 5,
      speed: 97 - id,
      buff_type: "none"
    }
  }

  return cards
}

// 現在のbattle.ymlと同じCPU設定を持つテストデータを作る
function createBattleConfig() {
  return {
    cpu: {
      difficulty: {
        normal_min_display_rate: 600,
        hard_min_display_rate: 1500,
        high_rate_selection: {
          weak_ratio: 0.3,
          normal_ratio: 0.5,
          hard_ratio: 0.1,
          super_hard_ratio: 0.1
        }
      },
      level: {
        internal_rate_divisor: 1000,
        random_step: 0.1,
        rare_adjustment: {
          min_id: 6,
          add_before: 1,
          multiplier: 0.5,
          add_after: 0
        }
      },
      deck: {
        super_weak: {
          candidate_ids: "1,2,3,4,5",
          card_count: 2,
          level: 1,
          rental_count: 3
        },
        weak: {
          min_level_offset: -2,
          max_level_offset: 0
        },
        normal: {
          level_offset_limit: 1
        },
        hard: {
          min_level_offset: 0,
          max_level_offset: 2
        },
        super_hard: {
          lead_card: {
            count: 1,
            level_offset: 3
          },
          other_cards: {
            count: 4,
            level_offset: 1
          }
        }
      },
      rental: {
        candidate_ids: "1,2,3,4,5,7",
        min_candidate_count: 5,
        hp: 90,
        atk: 40,
        spd_base: 40
      }
    }
  }
}

// 常に同じ値を返す注入用乱数関数を作る
function constantRandom(value) {
  return () => value
}

// デッキのVからZまでを配列として返す
function deckCards(deck) {
  return [deck.cards.V, deck.cards.W, deck.cards.X, deck.cards.Y, deck.cards.Z]
}

// デッキがVからZの5枚と重複しないIDを持つことを検証する
function assertFiveUniqueCards(deck) {
  assert.deepEqual(Object.keys(deck.cards), ["V", "W", "X", "Y", "Z"])
  const cards = deckCards(deck)
  assert.equal(cards.length, 5)
  assert.equal(new Set(cards.map((card) => card.id)).size, 5)
}

describe("selectCpuDifficulty", () => {
  test("境界直前と境界値で低・中・高レート帯を切り替える", () => {
    const config = createBattleConfig()
    assert.equal(selectCpuDifficulty(599, config, constantRandom(0)), "super_weak")
    assert.equal(selectCpuDifficulty(600, config, constantRandom(0)), "super_weak")
    assert.equal(selectCpuDifficulty(1499, config, constantRandom(0.999)), "normal")
    assert.equal(selectCpuDifficulty(1500, config, constantRandom(0)), "weak")
  })

  test("低レート帯の2候補を均等境界で選ぶ", () => {
    const config = createBattleConfig()
    assert.equal(selectCpuDifficulty(0, config, constantRandom(0.499999)), "super_weak")
    assert.equal(selectCpuDifficulty(0, config, constantRandom(0.5)), "weak")
  })

  test("中レート帯の3候補を均等境界で選ぶ", () => {
    const config = createBattleConfig()
    assert.equal(selectCpuDifficulty(1000, config, constantRandom(0)), "super_weak")
    assert.equal(selectCpuDifficulty(1000, config, constantRandom(1 / 3)), "weak")
    assert.equal(selectCpuDifficulty(1000, config, constantRandom(2 / 3)), "normal")
  })

  test("高レート帯の設定比率で4難易度を選ぶ", () => {
    const config = createBattleConfig()
    assert.equal(selectCpuDifficulty(1500, config, constantRandom(0.299999)), "weak")
    assert.equal(selectCpuDifficulty(1500, config, constantRandom(0.3)), "normal")
    assert.equal(selectCpuDifficulty(1500, config, constantRandom(0.8)), "hard")
    assert.equal(selectCpuDifficulty(1500, config, constantRandom(0.9)), "super_hard")
  })

  test("高レート帯比率合計、閾値、表示レートの不正値を拒否する", () => {
    const invalidRatio = createBattleConfig()
    invalidRatio.cpu.difficulty.high_rate_selection.super_hard_ratio = 0.2
    assert.throws(() => selectCpuDifficulty(0, invalidRatio, constantRandom(0)), /比率合計は1.0/)

    const invalidThreshold = createBattleConfig()
    invalidThreshold.cpu.difficulty.normal_min_display_rate = 1500
    assert.throws(() => selectCpuDifficulty(0, invalidThreshold, constantRandom(0)), /未満/)
    assert.throws(() => selectCpuDifficulty(-1, createBattleConfig(), constantRandom(0)), /0以上の整数/)
  })

  test("0以上1未満ではない乱数結果を拒否する", () => {
    assert.throws(() => selectCpuDifficulty(0, createBattleConfig(), constantRandom(1)), /0以上1未満/)
    assert.throws(() => selectCpuDifficulty(0, createBattleConfig(), constantRandom(-0.1)), /0以上1未満/)
  })
})

describe("CPUレベル計算", () => {
  test("内部レートを設定除数で割って基準レベルを求める", () => {
    assert.equal(calculateBaseLevel(2000, createBattleConfig()), 2.0)
    assert.equal(calculateBaseLevel(1950, createBattleConfig()), 1.95)
  })

  test("基準レベルの不正入力と0以下の除数を拒否する", () => {
    assert.throws(() => calculateBaseLevel(1.5, createBattleConfig()), /0以上の整数/)
    const config = createBattleConfig()
    config.cpu.level.internal_rate_divisor = 0
    assert.throws(() => calculateBaseLevel(10, config), /0より大きい/)
  })

  test("0.1刻みの候補数を整数で扱い両端と中間を抽選する", () => {
    assert.equal(selectRandomLevel(-1, 1, 0.1, constantRandom(0)), -1)
    assert.equal(selectRandomLevel(-1, 1, 0.1, constantRandom(0.5)), 0)
    assert.equal(selectRandomLevel(-1, 1, 0.1, constantRandom(0.999999)), 1)
  })

  test("刻み幅で割り切れない範囲と不正乱数を拒否する", () => {
    assert.throws(() => selectRandomLevel(0, 1, 0.3, constantRandom(0)), /整数倍/)
    assert.throws(() => selectRandomLevel(0, 1, 0.1, constantRandom(Number.NaN)), /0以上1未満/)
  })

  test("ID6以上だけにレア補正式を適用し小数を保持する", () => {
    const config = createBattleConfig()
    assert.equal(applyRareLevelAdjustment(5, 4.2, config), 4.2)
    assert.equal(applyRareLevelAdjustment(6, 4.2, config), 2.6)
  })
})

describe("レンタルカード", () => {
  test("固定HP・ATKとspd_baseに元speedの1の位を加えたSPDを持つ", () => {
    const syukamonData = createSyukamonData()
    syukamonData.kaguya.speed = 57
    const config = createBattleConfig()
    config.cpu.rental.spd_base = 49
    const card = createRentalCard({ id: 1, syukamonData, battleConfig: config })

    assert.deepEqual(card, {
      id: 1,
      type: "mon",
      exp: null,
      rawLevel: null,
      level: null,
      levelOffset: null,
      initialHp: 90,
      currentHp: 90,
      initialAtk: 40,
      currentAtk: 40,
      initialSpd: 56,
      currentSpd: 56,
      buffType: null,
      buffAmount: 0,
      canBattle: true,
      revengeBuffPending: false,
      isRental: true
    })
  })

  test("spd_baseの1の位が0でなくてもそのまま加算する", () => {
    const config = createBattleConfig()
    config.cpu.rental.spd_base = 49
    assert.equal(createRentalCard({ id: 1, syukamonData: createSyukamonData(), battleConfig: config }).initialSpd, 55)
  })
})

describe("難易度別CPUデッキ", () => {
  test("super_weakは通常2枚とレンタル3枚を重複なしで配置する", () => {
    const deck = buildSuperWeakDeck({
      syukamonData: createSyukamonData(),
      battleConfig: createBattleConfig(),
      randomFn: constantRandom(0)
    })
    assert.equal(deck.difficulty, "super_weak")
    assertFiveUniqueCards(deck)
    assert.equal(deckCards(deck).filter((card) => card.isRental === false).length, 2)
    assert.equal(deckCards(deck).filter((card) => card.isRental === true).length, 3)
  })

  test("weakはMath.round結果が0以下の通常カードをすべてレンタル化する", () => {
    const deck = buildWeakDeck({
      internalRate: 0,
      syukamonData: createSyukamonData(),
      battleConfig: createBattleConfig(),
      randomFn: constantRandom(0)
    })
    assert.equal(deck.difficulty, "weak")
    assertFiveUniqueCards(deck)
    assert.ok(deckCards(deck).every((card) => card.isRental === true))
  })

  test("normalは各カードで抽選し0以下をレベル1へ補正する", () => {
    const deck = buildNormalDeck({
      internalRate: 0,
      syukamonData: createSyukamonData(),
      battleConfig: createBattleConfig(),
      randomFn: constantRandom(0)
    })
    assert.equal(deck.difficulty, "normal")
    assertFiveUniqueCards(deck)
    assert.ok(deckCards(deck).every((card) => card.isRental === false && card.level >= 1))
  })

  test("hardは5枚の通常カードを作り0以下をレベル1へ補正する", () => {
    const deck = buildHardDeck({
      internalRate: 0,
      syukamonData: createSyukamonData(),
      battleConfig: createBattleConfig(),
      randomFn: constantRandom(0)
    })
    assert.equal(deck.difficulty, "hard")
    assertFiveUniqueCards(deck)
    assert.ok(deckCards(deck).every((card) => card.isRental === false && card.level >= 1))
  })

  test("super_hardはlead 1枚とother 4枚の補正を適用する", () => {
    const deck = buildSuperHardDeck({
      internalRate: 2000,
      syukamonData: createSyukamonData(),
      battleConfig: createBattleConfig(),
      randomFn: constantRandom(0)
    })
    assert.equal(deck.difficulty, "super_hard")
    assertFiveUniqueCards(deck)
    const cards = deckCards(deck)
    assert.equal(cards[0].rawLevel, 5)
    assert.equal(cards[1].rawLevel, 3)
    assert.ok(cards.every((card) => card.isRental === false && card.level >= 1))
  })

  test("統合デッキ関数が5難易度を個別関数へ振り分ける", () => {
    for (const difficulty of ["super_weak", "weak", "normal", "hard", "super_hard"]) {
      const deck = buildCpuDeck({
        difficulty,
        internalRate: difficulty === "weak" ? 3000 : 2000,
        syukamonData: createSyukamonData(),
        battleConfig: createBattleConfig(),
        randomFn: constantRandom(0)
      })
      assert.equal(deck.difficulty, difficulty)
      assertFiveUniqueCards(deck)
    }
  })

  test("createCpuDeckが確定済み難易度を再抽選せずデッキ生成に使う", () => {
    let callCount = 0
    const randomFn = () => {
      callCount += 1
      return 0
    }
    const deck = createCpuDeck({
      difficulty: "super_weak",
      internalRate: 1000,
      syukamonData: createSyukamonData(),
      battleConfig: createBattleConfig(),
      randomFn
    })
    assert.equal(deck.difficulty, "super_weak")
    assertFiveUniqueCards(deck)
    assert.ok(callCount > 1)
  })

  test("レンタル候補が重複除去後に5種類未満ならエラーにする", () => {
    const config = createBattleConfig()
    config.cpu.rental.candidate_ids = "1,1,2,3,4"
    assert.throws(
      () => buildWeakDeck({
        internalRate: 0,
        syukamonData: createSyukamonData(),
        battleConfig: config,
        randomFn: constantRandom(0)
      }),
      /5種類以上/
    )
  })

  test("通常カードとレンタルの重複回避後に候補不足ならエラーにする", () => {
    const config = createBattleConfig()
    config.cpu.deck.super_weak.card_count = 4
    config.cpu.deck.super_weak.rental_count = 1
    config.cpu.deck.super_weak.candidate_ids = "1,2,3,4"
    config.cpu.rental.candidate_ids = "1,2,3,4"
    config.cpu.rental.min_candidate_count = 4
    assert.throws(
      () => buildSuperWeakDeck({
        syukamonData: createSyukamonData(),
        battleConfig: config,
        randomFn: constantRandom(0)
      }),
      /候補が不足/
    )
  })

  test("super_hardの枚数合計が5でなければエラーにする", () => {
    const config = createBattleConfig()
    config.cpu.deck.super_hard.other_cards.count = 3
    assert.throws(
      () => buildSuperHardDeck({
        internalRate: 20,
        syukamonData: createSyukamonData(),
        battleConfig: config,
        randomFn: constantRandom(0)
      }),
      /合計は5/
    )
  })
})

describe("selectRandomCpuCard", () => {
  test("戦闘可能な通常・レンタルカードから注入乱数で1枚を返す", () => {
    const cards = {
      V: { id: 1, canBattle: true, isRental: false },
      W: { id: 2, canBattle: false, isRental: false },
      X: { id: 3, canBattle: true, isRental: true },
      Y: { id: 4, canBattle: false, isRental: true },
      Z: { id: 5, canBattle: true, isRental: false }
    }
    assert.equal(selectRandomCpuCard(cards, "normal", constantRandom(0)).id, 1)
    assert.equal(selectRandomCpuCard(cards, "normal", constantRandom(0.5)).id, 3)
    assert.equal(selectRandomCpuCard(cards, "normal", constantRandom(0.999)).id, 5)
  })

  test("撃破済みカードを除外し候補がなければnullを返す", () => {
    const cards = {
      V: { id: 1, canBattle: false },
      W: { id: 2, canBattle: false },
      X: { id: 3, canBattle: false },
      Y: { id: 4, canBattle: false },
      Z: { id: 5, canBattle: false }
    }
    assert.equal(selectRandomCpuCard(cards, "weak", constantRandom(0)), null)
  })

  test("difficulty未指定・不正値と不正乱数を拒否する", () => {
    const cards = {
      V: { id: 1, canBattle: true },
      W: { id: 2, canBattle: false },
      X: { id: 3, canBattle: false },
      Y: { id: 4, canBattle: false },
      Z: { id: 5, canBattle: false }
    }
    assert.throws(() => selectRandomCpuCard(cards, undefined, constantRandom(0)), /不正なCPU難易度/)
    assert.throws(() => selectRandomCpuCard(cards, "legend", constantRandom(0)), /不正なCPU難易度/)
    assert.throws(() => selectRandomCpuCard(cards, "normal", constantRandom(1)), /0以上1未満/)
  })
})
