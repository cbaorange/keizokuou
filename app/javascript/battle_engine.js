const ATTRIBUTE_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
const ACTIVE_BUFF_TYPES = ["atk", "hp", "spd"]
const NO_BUFF_TYPE = "none"

// ==============================
// 外部から呼び出す関数
// ==============================

// EXPまたは指定レベルとYAML由来データから共通形式のバトルカードを作成する
export function createBattleCard(cardInput, syukamonData) {
  if (cardInput === null || typeof cardInput !== "object" || Array.isArray(cardInput)) {
    throw new TypeError("cardInputはオブジェクトである必要があります")
  }

  const { id, exp, level: inputLevel } = cardInput
  requireCardId(id)

  const hasExp = exp !== undefined
  const hasLevel = inputLevel !== undefined
  if (hasExp === hasLevel) {
    throw new Error("EXPまたはレベルのどちらか一方だけを指定してください")
  }

  if (hasExp && (!Number.isInteger(exp) || exp < 0)) {
    throw new RangeError("EXPは0以上の整数である必要があります")
  }
  if (hasLevel) {
    requireFiniteNumber(inputLevel, "レベル")
    if (inputLevel <= 0) {
      throw new RangeError("レベルは0より大きい必要があります")
    }
  }

  const cardData = findCardDataById(id, syukamonData)
  validateCardData(cardData)

  const rawLevel = hasExp ? calculateLevel(id, exp) : inputLevel
  const level = roundLevelForStatus(rawLevel)
  // levelOffsetには、ステータス計算用レベルから1を引いた値を格納する
  const levelOffset = calculateLevelOffset(level)
  const initialHp = calculateStatusValue(cardData.health_base, cardData.health_grow, levelOffset)
  const initialAtk = calculateStatusValue(cardData.attack_base, cardData.attack_grow, levelOffset)
  const initialSpd = cardData.speed

  let buffAmount = 0
  if (cardData.buff_type === "atk" || cardData.buff_type === "hp") {
    buffAmount = calculateStatusValue(cardData.buff_base, cardData.buff_grow, levelOffset)
  } else if (cardData.buff_type === "spd") {
    buffAmount = cardData.buff_base
  }

  return {
    id,
    type: cardData.type,
    exp: hasExp ? exp : null,
    rawLevel,
    level,
    levelOffset,
    initialHp,
    currentHp: initialHp,
    initialAtk,
    currentAtk: initialAtk,
    initialSpd,
    currentSpd: initialSpd,
    buffType: cardData.buff_type,
    buffAmount,
    canBattle: true,
    revengeBuffPending: false
  }
}

// 現在の素早さを比較し、同速時は注入された乱数で先攻を決定する
export function determineFirstAttacker(userCard, enemyCard, randomFn = Math.random) {
  requireFiniteNumber(userCard?.currentSpd, "ユーザーカードのcurrentSpd")
  requireFiniteNumber(enemyCard?.currentSpd, "エネミーカードのcurrentSpd")
  if (typeof randomFn !== "function") {
    throw new TypeError("randomFnは関数である必要があります")
  }

  if (userCard.currentSpd > enemyCard.currentSpd) return "user"
  if (userCard.currentSpd < enemyCard.currentSpd) return "enemy"

  const randomValue = randomFn()
  requireFiniteNumber(randomValue, "乱数")
  if (randomValue < 0 || randomValue >= 1) {
    throw new RangeError("乱数は0以上1未満である必要があります")
  }
  return randomValue < 0.5 ? "user" : "enemy"
}

// 状態を変更せず、現在の戦闘状態と属性相性から攻撃可能かを返す
export function canAttack(attacker, defender) {
  return canCardAttack(attacker, defender)
}

// 状態を変更せず、攻撃側が防御側へ属性有利かを返す
export function hasAttributeAdvantage(attacker, defender) {
  return getAttributeRelation(attacker?.type, defender?.type) === "advantage"
}

// 実攻撃と同じ計算を使い、攻撃後の状態だけを副作用なしで予測する
export function previewAttack(attacker, defender, battleConfig) {
  const defenderHpBefore = defender?.currentHp
  const attackerSpdBefore = attacker?.currentSpd

  if (!canCardAttack(attacker, defender)) {
    return {
      attackSucceeded: false,
      damage: 0,
      defeated: false,
      defenderHpBefore,
      defenderHpAfter: defender?.currentHp,
      attackerSpdBefore,
      attackerSpdAfter: attacker?.currentSpd
    }
  }

  const damage = calculateDamage(attacker)
  const defenderHpAfter = calculateHpAfterDamage(defender, damage)

  return {
    attackSucceeded: true,
    damage,
    defeated: defenderHpAfter <= 0,
    defenderHpBefore,
    defenderHpAfter,
    attackerSpdBefore,
    attackerSpdAfter: calculateAttackSpeedAfter(attacker, battleConfig)
  }
}

// 攻撃1回分の状態計算を行い、表示に必要な変更前後の値を返す
export function resolveAttack(attacker, defender, battleConfig) {
  const result = previewAttack(attacker, defender, battleConfig)
  if (!result.attackSucceeded) return result

  defender.currentHp = result.defenderHpAfter
  const defeated = updateDefeatState(defender)
  attacker.currentSpd = result.attackerSpdAfter

  return {
    ...result,
    defeated
  }
}

// 未処理の味方撃破数だけ生存中のバフカードを強化し処理済みにする
export function applyPendingRevengeBuffs(teamCards) {
  if (!Array.isArray(teamCards)) {
    throw new TypeError("teamCardsは配列である必要があります")
  }

  const pendingDefeats = teamCards.filter((card) => card.revengeBuffPending === true)

  for (const card of teamCards) {
    if (card.canBattle !== true || card.buffAmount <= 0 || card.buffType === NO_BUFF_TYPE) continue
    if (!ACTIVE_BUFF_TYPES.includes(card.buffType)) {
      throw new RangeError(`不正なbuffTypeです: ${card.buffType}`)
    }
    requireFiniteNumber(card.buffAmount, "buffAmount")

    const totalBuff = card.buffAmount * pendingDefeats.length
    if (card.buffType === "atk") card.currentAtk += totalBuff
    if (card.buffType === "hp") card.currentHp += totalBuff
    if (card.buffType === "spd") card.currentSpd += totalBuff
  }

  for (const defeatedCard of pendingDefeats) {
    defeatedCard.revengeBuffPending = false
  }

  return pendingDefeats.length
}

// チーム内に戦闘可能なカードが1枚以上あるかを判定する
export function hasBattleableCard(teamCards) {
  if (!Array.isArray(teamCards)) {
    throw new TypeError("teamCardsは配列である必要があります")
  }
  return teamCards.some((card) => card.canBattle === true)
}

// ==============================
// 内部計算用
// 外部ファイルから直接呼び出さない
// ==============================

// 値が有限数であることを検証する
function requireFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label}は有限数である必要があります`)
  }
}

// カードIDが正の整数であることを検証する
function requireCardId(id) {
  if (!Number.isInteger(id) || id <= 0) {
    throw new RangeError("カードIDは正の整数である必要があります")
  }
}

// 属性が定義済みの7属性のいずれかであることを検証する
function requireAttribute(attribute) {
  if (!ATTRIBUTE_ORDER.includes(attribute)) {
    throw new RangeError(`不正な属性です: ${attribute}`)
  }
}

// syukamonデータから指定IDのカード定義を取得する
function findCardDataById(id, syukamonData) {
  if (syukamonData === null || typeof syukamonData !== "object" || Array.isArray(syukamonData)) {
    throw new TypeError("syukamonDataはオブジェクトである必要があります")
  }

  const cardData = Object.values(syukamonData).find((data) => data?.id === id)
  if (cardData === undefined) {
    throw new RangeError(`カードID ${id} のデータが存在しません`)
  }

  return cardData
}

// カード作成に必要なYAML由来データを検証する
function validateCardData(cardData) {
  requireCardId(cardData.id)
  requireAttribute(cardData.type)

  for (const key of ["health_base", "health_grow", "attack_base", "attack_grow", "speed"]) {
    requireFiniteNumber(cardData[key], key)
  }

  if (![...ACTIVE_BUFF_TYPES, NO_BUFF_TYPE].includes(cardData.buff_type)) {
    throw new RangeError(`不正なbuff_typeです: ${cardData.buff_type}`)
  }

  if (ACTIVE_BUFF_TYPES.includes(cardData.buff_type)) {
    requireFiniteNumber(cardData.buff_base, "buff_base")
    requireFiniteNumber(cardData.buff_grow, "buff_grow")
  }
}

// 経験値とカードIDから現在のレベルを計算する
function calculateLevel(id, exp) {
  requireCardId(id)
  if (!Number.isInteger(exp) || exp < 0) {
    throw new RangeError("EXPは0以上の整数である必要があります")
  }

  let remainingExp = exp
  let requiredExp = id < 6 ? 20 : 15
  let level = 1

  while (remainingExp >= requiredExp) {
    remainingExp -= requiredExp
    level += 1
    requiredExp += 20
  }

  return level
}

// 入力レベルをステータス計算用の整数へ四捨五入する
function roundLevelForStatus(rawLevel) {
  requireFiniteNumber(rawLevel, "レベル")
  if (rawLevel <= 0) {
    throw new RangeError("レベルは0より大きい必要があります")
  }

  const level = Math.round(rawLevel)
  if (level < 1) {
    throw new RangeError("四捨五入後のレベルは1以上である必要があります")
  }

  return level
}

// 整数レベルから成長計算用のレベル補正値を求める
function calculateLevelOffset(level) {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError("ステータス計算用レベルは1以上の整数である必要があります")
  }

  return level - 1
}

// 基礎値と成長値から指定レベルのステータス値を計算する
function calculateStatusValue(base, grow, levelOffset) {
  requireFiniteNumber(base, "base")
  requireFiniteNumber(grow, "grow")
  if (!Number.isInteger(levelOffset) || levelOffset < 0) {
    throw new RangeError("levelOffsetは0以上の整数である必要があります")
  }

  return base + (grow * levelOffset)
}

// 攻撃側から見た防御側との属性相性を判定する
function getAttributeRelation(attackerType, defenderType) {
  requireAttribute(attackerType)
  requireAttribute(defenderType)

  const attackerIndex = ATTRIBUTE_ORDER.indexOf(attackerType)
  const previousIndex = (attackerIndex - 1 + ATTRIBUTE_ORDER.length) % ATTRIBUTE_ORDER.length
  const nextIndex = (attackerIndex + 1) % ATTRIBUTE_ORDER.length

  if (ATTRIBUTE_ORDER[previousIndex] === defenderType) return "advantage"
  if (ATTRIBUTE_ORDER[nextIndex] === defenderType) return "disadvantage"
  return "neutral"
}

// 両カードの戦闘状態と属性相性から攻撃可能かを判定する
function canCardAttack(attacker, defender) {
  if (attacker?.canBattle !== true || defender?.canBattle !== true) return false
  return getAttributeRelation(attacker.type, defender.type) !== "disadvantage"
}

// 攻撃側カードの現在攻撃力からダメージを計算する
function calculateDamage(attacker) {
  requireFiniteNumber(attacker?.currentAtk, "currentAtk")
  if (attacker.currentAtk < 0) {
    throw new RangeError("currentAtkは0以上である必要があります")
  }
  return attacker.currentAtk
}

// 防御側カードの現在HPからダメージ適用後のHPを副作用なしで計算する
function calculateHpAfterDamage(defender, damage) {
  requireFiniteNumber(defender?.currentHp, "currentHp")
  requireFiniteNumber(damage, "damage")
  if (damage < 0) {
    throw new RangeError("damageは0以上である必要があります")
  }

  return Math.max(0, defender.currentHp - damage)
}

// HPが尽きたカードを初回だけ撃破状態へ更新する
function updateDefeatState(card) {
  requireFiniteNumber(card?.currentHp, "currentHp")
  if (card.currentHp > 0 || card.canBattle === false) return false

  card.canBattle = false
  card.revengeBuffPending = true
  return true
}

// 成立した攻撃後の現在SPDを副作用なしで計算する
function calculateAttackSpeedAfter(card, battleConfig) {
  requireFiniteNumber(card?.currentSpd, "currentSpd")
  const speedLoss = battleConfig?.attack?.spd_loss
  requireFiniteNumber(speedLoss, "attack.spd_loss")
  if (speedLoss < 0) {
    throw new RangeError("attack.spd_lossは0以上である必要があります")
  }

  return Math.max(0, card.currentSpd - speedLoss)
}
