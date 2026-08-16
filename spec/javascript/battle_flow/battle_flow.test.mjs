import test, { describe } from "node:test"
import assert from "node:assert/strict"

import {
  createBattleContext,
  prepareCpuDeck,
  prepareUserDeck,
  readLocalDeck,
  saveBattleResult
} from "../../../app/javascript/battle_flow.js"

function createSyukamonData() {
  const cards = {}
  const names = ["kaguya", "athena", "suibo", "tesla", "midas", "rex", "amaterasu"]
  const types = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

  names.forEach((name, index) => {
    const id = index + 1
    cards[name] = {
      id,
      name,
      short_name: name,
      image_tag_cards: `cards/${name}.PNG`,
      image_tag_portraits: `portraits/${name}.PNG`,
      type: types[index],
      health_base: 100 + id,
      health_grow: 10,
      attack_base: 40 + id,
      attack_grow: 5,
      speed: 100 - id,
      buff_type: "none"
    }
  })

  return cards
}

function createBattleConfig() {
  return {
    attack: { spd_loss: 10 },
    result: { card_width_ratio: 1.2 },
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
          rental_count: 3,
          level: 1
        },
        weak: { min_level_offset: -2, max_level_offset: 0 },
        normal: { level_offset_limit: 1 },
        hard: { min_level_offset: 0, max_level_offset: 2 },
        super_hard: {
          lead_card: { count: 1, level_offset: 3 },
          other_cards: { count: 4, level_offset: 1 }
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

function createMobileConfig() {
  return {
    battle_mobile: {
      user_hand: {
        card_gap_ratio: 0.05,
        vertical_edge_margin_ratio: 0.1,
        edge_margin_ratio: 0.1
      },
      hp: { bar_width_ratio: 0.6, user_text_font_size_rem: 0.9 },
      level: { offset_x_ratio: 0.1, offset_y_ratio: 0.1, user_font_size_rem: 0.7 },
      battle_area: { center_offset_y_ratio: 0.16 },
      cut_in: { rectangle_height_rem: 5, text: { font_size_rem: 2.5 } }
    }
  }
}

const zeroRandom = () => 0

describe("readLocalDeck", () => {
  test("有効な5スロットを位置どおり読み取る", () => {
    const storage = { getItem: () => "[1,2,0,4,5]" }
    assert.deepEqual(readLocalDeck(storage), [1, 2, 0, 4, 5])
  })

  test("未保存または不正形式をメモリ上の空デッキにし、書き込まない", () => {
    let writeCount = 0
    const missingStorage = { getItem: () => null, setItem: () => { writeCount += 1 } }
    const invalidStorage = { getItem: () => '{"old":true}', setItem: () => { writeCount += 1 } }

    assert.deepEqual(readLocalDeck(missingStorage), [0, 0, 0, 0, 0])
    assert.deepEqual(readLocalDeck(invalidStorage), [0, 0, 0, 0, 0])
    assert.equal(writeCount, 0)
  })
})

describe("prepareUserDeck", () => {
  test("配列0から4をAからEへ割り当て、通常カードへisRental falseを付ける", () => {
    const deck = prepareUserDeck({
      localDeck: [1, 2, 3, 4, 5],
      ownedCards: [1, 2, 3, 4, 5].map((cardId) => ({ cardId, exp: 1 })),
      syukamonData: createSyukamonData(),
      battleConfig: createBattleConfig(),
      randomFn: zeroRandom
    })

    assert.deepEqual(Object.keys(deck), ["A", "B", "C", "D", "E"])
    assert.deepEqual(Object.values(deck).map((card) => card.id), [1, 2, 3, 4, 5])
    assert.equal(deck.A.isRental, false)
    assert.equal(deck.E.isRental, false)
  })

  test("未所有、0、YAML外、2件目の重複を元スロットのレンタルへ置き換える", () => {
    const deck = prepareUserDeck({
      localDeck: [1, 9, 0, 1, 5],
      ownedCards: [
        { cardId: 1, exp: 20 },
        { cardId: 5, exp: 1 },
        { cardId: 9, exp: 1 }
      ],
      syukamonData: createSyukamonData(),
      battleConfig: createBattleConfig(),
      randomFn: zeroRandom
    })

    assert.equal(deck.A.id, 1)
    assert.equal(deck.A.isRental, false)
    assert.equal(deck.B.isRental, true)
    assert.equal(deck.C.isRental, true)
    assert.equal(deck.D.isRental, true)
    assert.equal(deck.E.id, 5)
    assert.equal(deck.E.isRental, false)
    assert.equal(new Set([deck.B.id, deck.C.id, deck.D.id]).size, 3)
    assert.ok([deck.B.id, deck.C.id, deck.D.id].every((id) => ![1, 5].includes(id)))
  })
})

test("確定済み難易度と開始変動後内部レートでCPUデッキをVからZへ生成する", () => {
  const cpuDeck = prepareCpuDeck({
    difficulty: "super_weak",
    internalRate: 0,
    syukamonData: createSyukamonData(),
    battleConfig: createBattleConfig(),
    randomFn: zeroRandom
  })

  assert.equal(cpuDeck.difficulty, "super_weak")
  assert.deepEqual(Object.keys(cpuDeck.cards), ["V", "W", "X", "Y", "Z"])
})

test("戦闘コンテキストへCPU難易度、設定、アセットを保持する", () => {
  const syukamon = createSyukamonData()
  const context = createBattleContext({
    bootstrapData: {
      ownedCards: [],
      rates: { displayRate: 0, internalRate: 1950 },
      battleSession: {
        token: "battle-token",
        difficulty: "normal",
        displayRateBeforeBattle: 0,
        displayRateWinBonus: 17
      },
      config: {
        syukamon,
        battle: createBattleConfig(),
        animations: {
          attack_wait: { first: { duration_ms: 1200 } }
        },
        effects: { ring_base: {} },
        mobile: createMobileConfig()
      },
      assets: {
        cardBackUrl: "/assets/cards/card_back.PNG",
        cardImageUrls: Object.fromEntries(Object.values(syukamon).map((card) => [card.id, `/cards/${card.id}`])),
        rentalCardImageUrls: Object.fromEntries(Object.values(syukamon).map((card) => [card.id, `/rental_cards/${card.id}`])),
        portraitImageUrls: Object.fromEntries(Object.values(syukamon).map((card) => [card.id, `/portraits/${card.id}`]))
      }
    },
    localDeck: [0, 0, 0, 0, 0],
    randomFn: zeroRandom
  })

  assert.equal(context.difficulty, "normal")
  assert.deepEqual(context.battleSession, {
    token: "battle-token",
    difficulty: "normal",
    displayRateBeforeBattle: 0,
    displayRateWinBonus: 17
  })
  assert.equal(context.config.animations.attack_wait.first.duration_ms, 1200)
  assert.equal(context.assets.cardBackUrl, "/assets/cards/card_back.PNG")
  assert.throws(
    () => createBattleContext({
      bootstrapData: {
        ownedCards: [],
        rates: { displayRate: -1, internalRate: 0 },
        battleSession: {
          token: "battle-token",
          difficulty: "normal",
          displayRateBeforeBattle: -1,
          displayRateWinBonus: 0
        },
        config: { syukamon, battle: createBattleConfig(), animations: {}, effects: {}, mobile: createMobileConfig() },
        assets: { cardBackUrl: "/back", cardImageUrls: {}, rentalCardImageUrls: {}, portraitImageUrls: {} }
      },
      localDeck: [0, 0, 0, 0, 0],
      randomFn: zeroRandom
    }),
    /表示レートは0以上の整数/
  )
})

function requestDocument() {
  return {
    querySelector: () => ({ content: "csrf-token" })
  }
}

test("結果保存APIへtokenと勝敗だけを送る", async () => {
  let requestBody
  await saveBattleResult({
    battleSessionToken: "session-token",
    result: "win",
    documentRef: requestDocument(),
    origin: "http://example.test",
    fetchFn: async (_url, options) => {
      requestBody = JSON.parse(options.body)
      return {
        ok: true,
        json: async () => ({
          battleSession: { token: "session-token", result: "win" }
        })
      }
    }
  })

  assert.deepEqual(requestBody, {
    battle_session_token: "session-token",
    result: "win"
  })
})
