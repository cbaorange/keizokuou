// 消さないで!!
const CPU_DIFFICULTIES = ["super_weak", "weak", "normal", "hard", "super_hard"]
const CARD_SLOTS = ["V", "W", "X", "Y", "Z"]

// CPU難易度が有効であることを検証する
function requireDifficulty(difficulty) {
  if (!CPU_DIFFICULTIES.includes(difficulty)) {
    throw new RangeError(`不正なCPU難易度です: ${difficulty}`)
  }
}

// enemyCardsがVからZまでのカード状態を持つことを検証する
function requireEnemyCards(enemyCards) {
  if (enemyCards === null || typeof enemyCards !== "object" || Array.isArray(enemyCards)) {
    throw new TypeError("enemyCardsはオブジェクトである必要があります")
  }

  for (const slot of CARD_SLOTS) {
    if (!Object.prototype.hasOwnProperty.call(enemyCards, slot)) {
      throw new RangeError(`enemyCardsにスロット${slot}がありません`)
    }
  }
}

// 注入された乱数生成関数を検証する
function requireRandomFunction(randomFn) {
  if (typeof randomFn !== "function") {
    throw new TypeError("randomFnは関数である必要があります")
  }
}

// 注入された乱数生成関数から0以上1未満の値を取得する
function getRandomValue(randomFn) {
  const value = randomFn()
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("randomFnの結果は0以上1未満の有限数である必要があります")
  }
  return value
}

// 戦闘可能なエネミーカードから注入乱数で1枚を選ぶ
export function selectRandomCpuCard(enemyCards, difficulty, randomFn = Math.random) {
  requireEnemyCards(enemyCards)
  requireDifficulty(difficulty)
  requireRandomFunction(randomFn)
  const battleableCards = []

  for (const slot of CARD_SLOTS) {
    const card = enemyCards[slot]
    if (card !== null && typeof card === "object" && card.canBattle === true) {
      battleableCards.push(card)
    }
  }

  if (battleableCards.length === 0) return null
  const selectedIndex = Math.floor(getRandomValue(randomFn) * battleableCards.length)
  return battleableCards[selectedIndex]
}
