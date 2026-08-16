import test, { describe } from "node:test"
import assert from "node:assert/strict"

import * as battleEngine from "../../../app/javascript/battle_engine.js"

const {
  applyPendingRevengeBuffs,
  canAttack,
  createBattleCard,
  determineFirstAttacker,
  hasAttributeAdvantage,
  hasBattleableCard,
  previewAttack,
  resolveAttack
} = battleEngine

const BATTLE_CONFIG = { attack: { spd_loss: 10 } }

// 実際のsyukamon.ymlと同じ、名前をルートキーに持つテスト用データを作る
function createSyukamonData() {
  return {
    kaguya: {
      id: 1,
      type: "mon",
      health_base: 150,
      health_grow: 40,
      attack_base: 50,
      attack_grow: 30,
      speed: 96,
      buff_type: "spd",
      buff_base: 30,
      buff_grow: 999
    },
    athena: {
      id: 2,
      type: "tue",
      health_base: 200,
      health_grow: 70,
      attack_base: 50,
      attack_grow: 20,
      speed: 95,
      buff_type: "none"
    },
    tesla: {
      id: 4,
      type: "thu",
      health_base: 90,
      health_grow: 30,
      attack_base: 60,
      attack_grow: 30,
      speed: 93,
      buff_type: "atk",
      buff_base: 30,
      buff_grow: 10
    },
    midas: {
      id: 5,
      type: "fri",
      health_base: 100,
      health_grow: 10,
      attack_base: 40,
      attack_grow: 10,
      speed: 85,
      buff_type: "none"
    },
    rex: {
      id: 6,
      type: "sat",
      health_base: 120,
      health_grow: 20,
      attack_base: 45,
      attack_grow: 15,
      speed: 90,
      buff_type: "none"
    },
    amaterasu: {
      id: 7,
      type: "sun",
      health_base: 160,
      health_grow: 80,
      attack_base: 60,
      attack_grow: 40,
      speed: 80,
      buff_type: "hp",
      buff_base: 50,
      buff_grow: 50
    }
  }
}

// 任意の項目を上書きした共通形式のテスト用バトルカードを作る
function createCard(overrides = {}) {
  return {
    id: 1,
    type: "mon",
    exp: 0,
    rawLevel: 1,
    level: 1,
    levelOffset: 0,
    initialHp: 100,
    currentHp: 100,
    initialAtk: 40,
    currentAtk: 40,
    initialSpd: 50,
    currentSpd: 50,
    buffType: "none",
    buffAmount: 0,
    canBattle: true,
    revengeBuffPending: false,
    ...overrides
  }
}

// 外部利用する関数だけが公開されていることを確認する
describe("公開関数", () => {
  test("攻撃予測を含む公開関数だけに限定する", () => {
    assert.deepEqual(Object.keys(battleEngine).sort(), [
      "applyPendingRevengeBuffs",
      "canAttack",
      "createBattleCard",
      "determineFirstAttacker",
      "hasAttributeAdvantage",
      "hasBattleableCard",
      "previewAttack",
      "resolveAttack"
    ])
  })
})

describe("canAttack", () => {
  test("通常相性と属性有利では攻撃できる", () => {
    assert.equal(canAttack(createCard({ type: "mon" }), createCard({ type: "wed" })), true)
    assert.equal(canAttack(createCard({ type: "mon" }), createCard({ type: "sun" })), true)
  })

  test("属性不利、撃破済み攻撃側、撃破済み防御側では攻撃できない", () => {
    assert.equal(canAttack(createCard({ type: "mon" }), createCard({ type: "tue" })), false)
    assert.equal(canAttack(createCard({ canBattle: false }), createCard()), false)
    assert.equal(canAttack(createCard(), createCard({ canBattle: false })), false)
  })
})

describe("hasAttributeAdvantage", () => {
  test("既存の属性循環に従って有利だけを返す", () => {
    assert.equal(hasAttributeAdvantage(createCard({ type: "mon" }), createCard({ type: "sun" })), true)
    assert.equal(hasAttributeAdvantage(createCard({ type: "mon" }), createCard({ type: "mon" })), false)
    assert.equal(hasAttributeAdvantage(createCard({ type: "mon" }), createCard({ type: "tue" })), false)
  })
})

// EXP入力とCPUレベル入力から共通カード状態が作られることを確認する
describe("createBattleCard", () => {
  test("ID5以下の必要EXP直前、到達時、複数レベルアップを計算する", () => {
    const data = createSyukamonData()
    assert.equal(createBattleCard({ id: 1, exp: 0 }, data).rawLevel, 1)
    assert.equal(createBattleCard({ id: 1, exp: 19 }, data).rawLevel, 1)
    assert.equal(createBattleCard({ id: 1, exp: 20 }, data).rawLevel, 2)
    assert.equal(createBattleCard({ id: 1, exp: 59 }, data).rawLevel, 2)
    assert.equal(createBattleCard({ id: 1, exp: 60 }, data).rawLevel, 3)
    assert.equal(createBattleCard({ id: 5, exp: 60 }, data).rawLevel, 3)
  })

  test("ID6以上の必要EXP直前、到達時、複数レベルアップを計算する", () => {
    const data = createSyukamonData()
    assert.equal(createBattleCard({ id: 6, exp: 0 }, data).rawLevel, 1)
    assert.equal(createBattleCard({ id: 6, exp: 14 }, data).rawLevel, 1)
    assert.equal(createBattleCard({ id: 6, exp: 15 }, data).rawLevel, 2)
    assert.equal(createBattleCard({ id: 6, exp: 49 }, data).rawLevel, 2)
    assert.equal(createBattleCard({ id: 6, exp: 50 }, data).rawLevel, 3)
  })

  test("整数と小数点以下0.4、0.5、0.9を四捨五入する", () => {
    const data = createSyukamonData()
    assert.equal(createBattleCard({ id: 1, level: 3 }, data).level, 3)
    assert.equal(createBattleCard({ id: 1, level: 3.4 }, data).level, 3)
    assert.equal(createBattleCard({ id: 1, level: 3.5 }, data).level, 4)
    assert.equal(createBattleCard({ id: 1, level: 3.9 }, data).level, 4)
  })

  test("整数レベルからレベルより1低い補正値を計算する", () => {
    const data = createSyukamonData()
    assert.equal(createBattleCard({ id: 1, level: 1 }, data).levelOffset, 0)
    assert.equal(createBattleCard({ id: 1, level: 4 }, data).levelOffset, 3)
  })

  test("四捨五入後に1未満となるレベルを拒否する", () => {
    assert.throws(() => createBattleCard({ id: 1, level: 0.4 }, createSyukamonData()), /1以上/)
  })

  test("レベル1ではbase、レベル2以上ではgrow加算値を返す", () => {
    const data = createSyukamonData()
    assert.equal(createBattleCard({ id: 1, level: 1 }, data).initialHp, 150)
    assert.equal(createBattleCard({ id: 1, level: 3 }, data).initialHp, 230)
  })

  test("EXP入力からHP、ATK、固定SPDを持つカードを作る", () => {
    const card = createBattleCard({ id: 1, exp: 60 }, createSyukamonData())

    assert.deepEqual(card, {
      id: 1,
      type: "mon",
      exp: 60,
      rawLevel: 3,
      level: 3,
      levelOffset: 2,
      initialHp: 230,
      currentHp: 230,
      initialAtk: 110,
      currentAtk: 110,
      initialSpd: 96,
      currentSpd: 96,
      buffType: "spd",
      buffAmount: 30,
      canBattle: true,
      revengeBuffPending: false
    })
  })

  test("小数レベルをrawLevelに保持し、四捨五入後のレベルで計算する", () => {
    const card = createBattleCard({ id: 4, level: 3.4 }, createSyukamonData())

    assert.equal(card.exp, null)
    assert.equal(card.rawLevel, 3.4)
    assert.equal(card.level, 3)
    assert.equal(card.levelOffset, 2)
    assert.equal(card.initialHp, 150)
    assert.equal(card.initialAtk, 120)
    assert.equal(card.initialSpd, 93)
    assert.equal(card.buffAmount, 50)
  })

  test("HPバフをレベル補正値で成長させる", () => {
    const card = createBattleCard({ id: 7, level: 2 }, createSyukamonData())
    assert.equal(card.buffAmount, 100)
  })

  test("EXPとレベルの両方指定、および両方未指定を拒否する", () => {
    const data = createSyukamonData()
    assert.throws(() => createBattleCard({ id: 1, exp: 0, level: 1 }, data), /どちらか一方/)
    assert.throws(() => createBattleCard({ id: 1 }, data), /どちらか一方/)
  })

  test("存在しないIDを拒否する", () => {
    assert.throws(() => createBattleCard({ id: 99, exp: 0 }, createSyukamonData()), /存在しません/)
  })

  test("必須ステータス不足と不明なバフ種別を拒否する", () => {
    const missingStatus = createSyukamonData()
    delete missingStatus.kaguya.health_base
    assert.throws(() => createBattleCard({ id: 1, exp: 0 }, missingStatus), /health_base/)

    const unknownBuff = createSyukamonData()
    unknownBuff.kaguya.buff_type = "magic"
    assert.throws(() => createBattleCard({ id: 1, exp: 0 }, unknownBuff), /buff_type/)
  })
})

// 素早さ比較と同速時に注入した乱数が使われることを確認する
describe("determineFirstAttacker", () => {
  test("素早い側を先攻にする", () => {
    assert.equal(determineFirstAttacker(createCard({ currentSpd: 51 }), createCard({ currentSpd: 50 })), "user")
    assert.equal(determineFirstAttacker(createCard({ currentSpd: 49 }), createCard({ currentSpd: 50 })), "enemy")
  })

  test("同速時は注入した乱数でユーザーまたはエネミーを選ぶ", () => {
    let callCount = 0
    const userResult = determineFirstAttacker(createCard(), createCard(), () => {
      callCount += 1
      return 0.49
    })
    assert.equal(userResult, "user")
    assert.equal(callCount, 1)
    assert.equal(determineFirstAttacker(createCard(), createCard(), () => 0.5), "enemy")
  })
})

// 攻撃1回分の計算と状態変更を公開関数経由で確認する
describe("resolveAttack", () => {
  test("previewAttackは実攻撃と同じ結果を返し、HP・SPD・撃破状態を変更しない", () => {
    const attacker = createCard({ type: "wed", currentAtk: 120, currentSpd: 50 })
    const defender = createCard({ type: "tue", currentHp: 100 })
    const prediction = previewAttack(attacker, defender, BATTLE_CONFIG)

    assert.deepEqual(prediction, {
      attackSucceeded: true,
      damage: 120,
      defeated: true,
      defenderHpBefore: 100,
      defenderHpAfter: 0,
      attackerSpdBefore: 50,
      attackerSpdAfter: 40
    })
    assert.equal(defender.currentHp, 100)
    assert.equal(defender.canBattle, true)
    assert.equal(defender.revengeBuffPending, false)
    assert.equal(attacker.currentSpd, 50)

    assert.deepEqual(resolveAttack(attacker, defender, BATTLE_CONFIG), prediction)
  })

  test("通常攻撃に成功し変更前後のHPとSPDを返す", () => {
    const attacker = createCard({ type: "wed", currentAtk: 30, currentSpd: 50 })
    const defender = createCard({ type: "sun", currentHp: 100 })

    assert.deepEqual(resolveAttack(attacker, defender, BATTLE_CONFIG), {
      attackSucceeded: true,
      damage: 30,
      defeated: false,
      defenderHpBefore: 100,
      defenderHpAfter: 70,
      attackerSpdBefore: 50,
      attackerSpdAfter: 40
    })
    assert.equal(defender.currentHp, 70)
    assert.equal(attacker.currentSpd, 40)
  })

  test("属性有利で攻撃に成功する", () => {
    const result = resolveAttack(
      createCard({ type: "wed" }),
      createCard({ type: "tue" }),
      BATTLE_CONFIG
    )
    assert.equal(result.attackSucceeded, true)
  })

  test("7属性すべてが前の曜日に攻撃でき、次の曜日には攻撃できない", () => {
    const attributes = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

    attributes.forEach((attribute, index) => {
      const previous = attributes[(index - 1 + attributes.length) % attributes.length]
      const next = attributes[(index + 1) % attributes.length]
      assert.equal(resolveAttack(createCard({ type: attribute }), createCard({ type: previous }), BATTLE_CONFIG).attackSucceeded, true)
      assert.equal(resolveAttack(createCard({ type: attribute }), createCard({ type: next }), BATTLE_CONFIG).attackSucceeded, false)
    })
  })

  test("同属性と離れた属性では通常攻撃に成功する", () => {
    assert.equal(resolveAttack(createCard({ type: "wed" }), createCard({ type: "wed" }), BATTLE_CONFIG).attackSucceeded, true)
    assert.equal(resolveAttack(createCard({ type: "wed" }), createCard({ type: "sun" }), BATTLE_CONFIG).attackSucceeded, true)
  })

  test("monとsunの境界を循環させる", () => {
    assert.equal(resolveAttack(createCard({ type: "mon" }), createCard({ type: "sun" }), BATTLE_CONFIG).attackSucceeded, true)
    assert.equal(resolveAttack(createCard({ type: "sun" }), createCard({ type: "mon" }), BATTLE_CONFIG).attackSucceeded, false)
  })

  test("不正な属性を拒否する", () => {
    assert.throws(() => resolveAttack(createCard({ type: "holiday" }), createCard(), BATTLE_CONFIG), /不正な属性/)
    assert.throws(() => resolveAttack(createCard(), createCard({ type: "holiday" }), BATTLE_CONFIG), /不正な属性/)
  })

  test("属性不利では状態を変更せず攻撃不成立の値を返す", () => {
    const attacker = createCard({ type: "wed", currentSpd: 15 })
    const defender = createCard({ type: "thu", currentHp: 80, revengeBuffPending: false })

    assert.deepEqual(resolveAttack(attacker, defender, {}), {
      attackSucceeded: false,
      damage: 0,
      defeated: false,
      defenderHpBefore: 80,
      defenderHpAfter: 80,
      attackerSpdBefore: 15,
      attackerSpdAfter: 15
    })
    assert.equal(defender.canBattle, true)
    assert.equal(defender.revengeBuffPending, false)
    assert.equal(attacker.currentSpd, 15)
  })

  test("攻撃側が撃破済みなら全対象状態を変更しない", () => {
    const attacker = createCard({ canBattle: false, currentSpd: 15 })
    const defender = createCard({ currentHp: 80 })
    const result = resolveAttack(attacker, defender, BATTLE_CONFIG)

    assert.equal(result.attackSucceeded, false)
    assert.equal(defender.currentHp, 80)
    assert.equal(defender.canBattle, true)
    assert.equal(defender.revengeBuffPending, false)
    assert.equal(attacker.currentSpd, 15)
  })

  test("防御側が撃破済みなら全対象状態を変更し撃破を二重発生させない", () => {
    const attacker = createCard({ currentSpd: 15 })
    const defender = createCard({ currentHp: 0, canBattle: false, revengeBuffPending: false })
    const result = resolveAttack(attacker, defender, BATTLE_CONFIG)

    assert.equal(result.attackSucceeded, false)
    assert.equal(result.defeated, false)
    assert.equal(defender.currentHp, 0)
    assert.equal(defender.canBattle, false)
    assert.equal(defender.revengeBuffPending, false)
    assert.equal(attacker.currentSpd, 15)
  })

  test("初期値ではなく現在ATKをダメージ量に使う", () => {
    const result = resolveAttack(
      createCard({ initialAtk: 40, currentAtk: 70 }),
      createCard({ currentHp: 100 }),
      BATTLE_CONFIG
    )
    assert.equal(result.damage, 70)
    assert.equal(result.defenderHpAfter, 30)
  })

  test("HPを0未満にせず初回撃破だけを返す", () => {
    const defender = createCard({ currentHp: 30 })
    const result = resolveAttack(createCard({ currentAtk: 70 }), defender, BATTLE_CONFIG)

    assert.equal(result.defenderHpBefore, 30)
    assert.equal(result.defenderHpAfter, 0)
    assert.equal(result.defeated, true)
    assert.equal(defender.canBattle, false)
    assert.equal(defender.revengeBuffPending, true)
  })

  test("HPが残る場合は生存状態を維持する", () => {
    const defender = createCard({ currentHp: 41 })
    const result = resolveAttack(createCard({ currentAtk: 40 }), defender, BATTLE_CONFIG)

    assert.equal(result.defeated, false)
    assert.equal(defender.currentHp, 1)
    assert.equal(defender.canBattle, true)
    assert.equal(defender.revengeBuffPending, false)
  })

  test("負数の現在ATKを拒否する", () => {
    assert.throws(() => resolveAttack(createCard({ currentAtk: -1 }), createCard(), BATTLE_CONFIG), /0以上/)
  })

  test("攻撃成功時にbattleConfigのSPD低下値を使う", () => {
    const attacker = createCard({ currentSpd: 15 })
    const result = resolveAttack(attacker, createCard(), { attack: { spd_loss: 7 } })

    assert.equal(result.attackerSpdBefore, 15)
    assert.equal(result.attackerSpdAfter, 8)
    assert.equal(attacker.currentSpd, 8)
  })

  test("SPDを0未満にしない", () => {
    const attacker = createCard({ currentSpd: 5 })
    const result = resolveAttack(attacker, createCard(), BATTLE_CONFIG)

    assert.equal(result.attackerSpdBefore, 5)
    assert.equal(result.attackerSpdAfter, 0)
    assert.equal(attacker.currentSpd, 0)
  })

  test("攻撃成功時はSPD低下設定の不足、数値以外、負数を拒否する", () => {
    assert.throws(() => resolveAttack(createCard(), createCard(), {}), /spd_loss/)
    assert.throws(() => resolveAttack(createCard(), createCard(), { attack: { spd_loss: "10" } }), /spd_loss/)
    assert.throws(() => resolveAttack(createCard(), createCard(), { attack: { spd_loss: -1 } }), /0以上/)
  })
})

// 未処理撃破ごとに生存中の各バフカードが一度強化されることを確認する
describe("applyPendingRevengeBuffs", () => {
  test("ATK、HP、SPDバフを適用しHPは初期値を超える", () => {
    const defeated = createCard({ canBattle: false, revengeBuffPending: true })
    const atkCard = createCard({ buffType: "atk", buffAmount: 10 })
    const hpCard = createCard({ currentHp: 95, buffType: "hp", buffAmount: 10 })
    const spdCard = createCard({ buffType: "spd", buffAmount: 10 })

    assert.equal(applyPendingRevengeBuffs([defeated, atkCard, hpCard, spdCard]), 1)
    assert.equal(atkCard.currentAtk, 50)
    assert.equal(hpCard.currentHp, 105)
    assert.equal(spdCard.currentSpd, 60)
    assert.equal(defeated.revengeBuffPending, false)
  })

  test("撃破済みバフカードとバフなしカードは強化しない", () => {
    const defeatedBuffCard = createCard({
      canBattle: false,
      revengeBuffPending: true,
      buffType: "atk",
      buffAmount: 10
    })
    const noBuffCard = createCard()

    applyPendingRevengeBuffs([defeatedBuffCard, noBuffCard])
    assert.equal(defeatedBuffCard.currentAtk, 40)
    assert.equal(noBuffCard.currentAtk, 40)
  })

  test("味方が倒されるたび何度でも発動するが同じ未処理撃破は再利用しない", () => {
    const firstDefeated = createCard({ canBattle: false, revengeBuffPending: true })
    const buffCard = createCard({ buffType: "atk", buffAmount: 10 })

    applyPendingRevengeBuffs([firstDefeated, buffCard])
    applyPendingRevengeBuffs([firstDefeated, buffCard])
    assert.equal(buffCard.currentAtk, 50)

    const secondDefeated = createCard({ canBattle: false, revengeBuffPending: true })
    applyPendingRevengeBuffs([firstDefeated, secondDefeated, buffCard])
    assert.equal(buffCard.currentAtk, 60)
  })

  test("複数の未処理撃破があれば回数分のバフを一度に適用する", () => {
    const defeatedCards = [
      createCard({ canBattle: false, revengeBuffPending: true }),
      createCard({ canBattle: false, revengeBuffPending: true })
    ]
    const buffCard = createCard({ buffType: "spd", buffAmount: 5 })

    assert.equal(applyPendingRevengeBuffs([...defeatedCards, buffCard]), 2)
    assert.equal(buffCard.currentSpd, 60)
  })
})

// 生存カードの有無と空チームを確認する
describe("hasBattleableCard", () => {
  test("生存カードが1枚以上あればtrueを返す", () => {
    assert.equal(hasBattleableCard([createCard({ canBattle: false }), createCard()]), true)
  })

  test("全員撃破済みと空配列ではfalseを返す", () => {
    assert.equal(hasBattleableCard([createCard({ canBattle: false })]), false)
    assert.equal(hasBattleableCard([]), false)
  })
})
