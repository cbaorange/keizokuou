// 消さないで!!
import { createBattleCard } from "./battle_engine.js"

const CPU_DIFFICULTIES = ["super_weak", "weak", "normal", "hard", "super_hard"]
const CARD_SLOTS = ["V", "W", "X", "Y", "Z"]
const DECK_CARD_COUNT = CARD_SLOTS.length
const RATIO_TOLERANCE = 1e-12
const LEVEL_RANGE_TOLERANCE = 1e-9

// 値が配列ではないオブジェクトであることを検証する
function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label}はオブジェクトである必要があります`)
  }
}

// 値が有限数であることを検証する
function requireFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label}は有限数である必要があります`)
  }
}

// 値が0以上の整数であることを検証する
function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label}は0以上の整数である必要があります`)
  }
}

// 値が正の整数であることを検証する
function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label}は正の整数である必要があります`)
  }
}

// 指定されたCPU難易度が有効であることを検証する
function requireDifficulty(difficulty) {
  if (!CPU_DIFFICULTIES.includes(difficulty)) {
    throw new RangeError(`不正なCPU難易度です: ${difficulty}`)
  }
}

// 乱数生成関数を検証する
function requireRandomFunction(randomFn) {
  if (typeof randomFn !== "function") {
    throw new TypeError("randomFnは関数である必要があります")
  }
}

// 注入された乱数生成関数から0以上1未満の値を取得する
function getRandomValue(randomFn) {
  requireRandomFunction(randomFn)
  const value = randomFn()
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("randomFnの結果は0以上1未満の有限数である必要があります")
  }
  return value
}

// battle.yml由来のCPU設定を取得する
function getCpuConfig(battleConfig) {
  requireObject(battleConfig, "battleConfig")
  requireObject(battleConfig.cpu, "battleConfig.cpu")
  return battleConfig.cpu
}

// syukamon.yml由来データをIDで参照できるMapへ変換する
function createSyukamonCatalog(syukamonData) {
  requireObject(syukamonData, "syukamonData")
  const catalog = new Map()

  for (const cardData of Object.values(syukamonData)) {
    requireObject(cardData, "シュカモンデータ")
    requirePositiveInteger(cardData.id, "シュカモンID")
    if (catalog.has(cardData.id)) {
      throw new Error(`シュカモンID ${cardData.id} が重複しています`)
    }
    catalog.set(cardData.id, cardData)
  }

  return catalog
}

// カンマ区切りの候補IDを解析し、重複を除いて存在を検証する
function parseCandidateIds(candidateIds, syukamonData, label) {
  if (typeof candidateIds !== "string" || candidateIds.trim() === "") {
    throw new TypeError(`${label}は空でないカンマ区切り文字列である必要があります`)
  }

  const catalog = createSyukamonCatalog(syukamonData)
  const parsedIds = []
  const seenIds = new Set()

  for (const token of candidateIds.split(",")) {
    const trimmedToken = token.trim()
    if (!/^\d+$/.test(trimmedToken)) {
      throw new RangeError(`${label}に不正なIDが含まれています: ${trimmedToken}`)
    }

    const id = Number(trimmedToken)
    requirePositiveInteger(id, label)
    if (!catalog.has(id)) {
      throw new RangeError(`${label}のカードID ${id} はsyukamonDataに存在しません`)
    }
    if (!seenIds.has(id)) {
      seenIds.add(id)
      parsedIds.push(id)
    }
  }

  return parsedIds
}

// 注入された乱数生成関数で配列をFisher-Yatesシャッフルする
function shuffleValues(values, randomFn) {
  requireRandomFunction(randomFn)
  const shuffled = [...values]

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(getRandomValue(randomFn) * (index + 1))
    const currentValue = shuffled[index]
    shuffled[index] = shuffled[swapIndex]
    shuffled[swapIndex] = currentValue
  }

  return shuffled
}

// 除外IDを避けながら候補から重複なしで指定枚数を選ぶ
function selectUniqueIds(candidateIds, count, excludedIds, randomFn, label) {
  requireNonNegativeInteger(count, `${label}の選択枚数`)
  const excludedIdSet = new Set(excludedIds)
  const availableIds = []

  for (const id of candidateIds) {
    if (!excludedIdSet.has(id)) availableIds.push(id)
  }

  if (availableIds.length < count) {
    throw new RangeError(`${label}の候補が不足しています。必要数: ${count}、候補数: ${availableIds.length}`)
  }

  return shuffleValues(availableIds, randomFn).slice(0, count)
}

// 小数演算で生じる微小な誤差を12桁までに丸める
function normalizeDecimal(value) {
  return Number(value.toFixed(12))
}

// 難易度抽選設定を検証し、閾値と高レート帯比率を返す
function validateDifficultyConfig(battleConfig) {
  const cpuConfig = getCpuConfig(battleConfig)
  requireObject(cpuConfig.difficulty, "cpu.difficulty")

  const difficultyConfig = cpuConfig.difficulty
  const normalMin = difficultyConfig.normal_min_display_rate
  const hardMin = difficultyConfig.hard_min_display_rate
  requireNonNegativeInteger(normalMin, "cpu.difficulty.normal_min_display_rate")
  requireNonNegativeInteger(hardMin, "cpu.difficulty.hard_min_display_rate")
  if (normalMin >= hardMin) {
    throw new RangeError("normal_min_display_rateはhard_min_display_rate未満である必要があります")
  }

  requireObject(difficultyConfig.high_rate_selection, "cpu.difficulty.high_rate_selection")
  const ratioConfig = difficultyConfig.high_rate_selection
  const ratios = [
    ratioConfig.weak_ratio,
    ratioConfig.normal_ratio,
    ratioConfig.hard_ratio,
    ratioConfig.super_hard_ratio
  ]

  let ratioTotal = 0
  for (const ratio of ratios) {
    requireFiniteNumber(ratio, "CPU難易度の高レート帯比率")
    if (ratio < 0) throw new RangeError("CPU難易度の高レート帯比率は0以上である必要があります")
    ratioTotal += ratio
  }
  if (Math.abs(ratioTotal - 1) > RATIO_TOLERANCE) {
    throw new RangeError("CPU難易度の高レート帯比率合計は1.0である必要があります")
  }

  return { normalMin, hardMin, ratios }
}

// 表示レートとbattle.yml由来設定からCPU難易度を抽選する
export function selectCpuDifficulty(displayRate, battleConfig, randomFn = Math.random) {
  requireNonNegativeInteger(displayRate, "表示レート")
  requireRandomFunction(randomFn)
  const { normalMin, hardMin, ratios } = validateDifficultyConfig(battleConfig)

  if (displayRate < normalMin) {
    const candidates = ["super_weak", "weak"]
    return candidates[Math.floor(getRandomValue(randomFn) * candidates.length)]
  }

  if (displayRate < hardMin) {
    const candidates = ["super_weak", "weak", "normal"]
    return candidates[Math.floor(getRandomValue(randomFn) * candidates.length)]
  }

  const candidates = ["weak", "normal", "hard", "super_hard"]
  const randomValue = getRandomValue(randomFn)
  let cumulativeRatio = 0

  for (let index = 0; index < candidates.length; index += 1) {
    cumulativeRatio += ratios[index]
    if (randomValue < cumulativeRatio) return candidates[index]
  }

  return candidates[candidates.length - 1]
}

// 内部レートとbattle.yml由来の除数からノーマルカード基準レベルを求める
export function calculateBaseLevel(internalRate, battleConfig) {
  requireNonNegativeInteger(internalRate, "内部レート")
  const cpuConfig = getCpuConfig(battleConfig)
  requireObject(cpuConfig.level, "cpu.level")
  const divisor = cpuConfig.level.internal_rate_divisor
  requireFiniteNumber(divisor, "cpu.level.internal_rate_divisor")
  if (divisor <= 0) {
    throw new RangeError("cpu.level.internal_rate_divisorは0より大きい必要があります")
  }
  return internalRate / divisor
}

// 最小値から最大値までを指定刻みの整数個の候補に分けて均等抽選する
export function selectRandomLevel(minLevel, maxLevel, randomStep, randomFn = Math.random) {
  requireFiniteNumber(minLevel, "最小レベル")
  requireFiniteNumber(maxLevel, "最大レベル")
  requireFiniteNumber(randomStep, "cpu.level.random_step")
  requireRandomFunction(randomFn)
  if (minLevel > maxLevel) throw new RangeError("最小レベルは最大レベル以下である必要があります")
  if (randomStep <= 0) throw new RangeError("cpu.level.random_stepは0より大きい必要があります")

  const stepCountValue = (maxLevel - minLevel) / randomStep
  const stepCount = Math.round(stepCountValue)
  if (Math.abs(stepCountValue - stepCount) > LEVEL_RANGE_TOLERANCE) {
    throw new RangeError("レベル範囲はcpu.level.random_stepの整数倍である必要があります")
  }

  const selectedStep = Math.floor(getRandomValue(randomFn) * (stepCount + 1))
  return normalizeDecimal(minLevel + (selectedStep * randomStep))
}

// IDが設定閾値以上の場合にbattle.yml由来のレアレベル補正を適用する
export function applyRareLevelAdjustment(id, level, battleConfig) {
  requirePositiveInteger(id, "シュカモンID")
  requireFiniteNumber(level, "補正前レベル")
  const cpuConfig = getCpuConfig(battleConfig)
  requireObject(cpuConfig.level, "cpu.level")
  requireObject(cpuConfig.level.rare_adjustment, "cpu.level.rare_adjustment")
  const adjustment = cpuConfig.level.rare_adjustment
  requirePositiveInteger(adjustment.min_id, "cpu.level.rare_adjustment.min_id")
  requireFiniteNumber(adjustment.add_before, "cpu.level.rare_adjustment.add_before")
  requireFiniteNumber(adjustment.multiplier, "cpu.level.rare_adjustment.multiplier")
  requireFiniteNumber(adjustment.add_after, "cpu.level.rare_adjustment.add_after")

  if (id < adjustment.min_id) return level
  const adjustedLevel = ((level + adjustment.add_before) * adjustment.multiplier) + adjustment.add_after
  requireFiniteNumber(adjustedLevel, "レア補正後レベル")
  return adjustedLevel
}

// 通常カードをbattle_engine.jsの共通形式で作りレンタル判定を付ける
function createNormalCard(id, rawLevel, syukamonData) {
  const card = createBattleCard({ id, level: rawLevel }, syukamonData)
  return { ...card, isRental: false }
}

// レンタル設定と元カード定義から共通形式のレンタルカードを作る
export function createRentalCard({ id, syukamonData, battleConfig }) {
  requirePositiveInteger(id, "レンタルカードID")
  const catalog = createSyukamonCatalog(syukamonData)
  const cardData = catalog.get(id)
  if (cardData === undefined) throw new RangeError(`レンタルカードID ${id} はsyukamonDataに存在しません`)
  if (typeof cardData.type !== "string" || cardData.type === "") {
    throw new TypeError(`カードID ${id} のtypeが不正です`)
  }
  requireNonNegativeInteger(cardData.speed, `カードID ${id} のspeed`)

  const cpuConfig = getCpuConfig(battleConfig)
  requireObject(cpuConfig.rental, "cpu.rental")
  const rentalConfig = cpuConfig.rental
  requireFiniteNumber(rentalConfig.hp, "cpu.rental.hp")
  requireFiniteNumber(rentalConfig.atk, "cpu.rental.atk")
  requireFiniteNumber(rentalConfig.spd_base, "cpu.rental.spd_base")
  if (rentalConfig.hp <= 0) throw new RangeError("cpu.rental.hpは0より大きい必要があります")
  if (rentalConfig.atk < 0) throw new RangeError("cpu.rental.atkは0以上である必要があります")
  if (rentalConfig.spd_base < 0) throw new RangeError("cpu.rental.spd_baseは0以上である必要があります")

  const initialSpd = rentalConfig.spd_base + (cardData.speed % 10)
  return {
    id,
    type: cardData.type,
    exp: null,
    rawLevel: null,
    level: null,
    levelOffset: null,
    initialHp: rentalConfig.hp,
    currentHp: rentalConfig.hp,
    initialAtk: rentalConfig.atk,
    currentAtk: rentalConfig.atk,
    initialSpd,
    currentSpd: initialSpd,
    buffType: null,
    buffAmount: 0,
    canBattle: true,
    revengeBuffPending: false,
    isRental: true
  }
}

// レンタル候補設定を検証し、使用済みIDを避けて必要枚数を作る
export function createRentalCards(count, excludedIds, syukamonData, battleConfig, randomFn) {
  requireNonNegativeInteger(count, "レンタルカード枚数")
  const cpuConfig = getCpuConfig(battleConfig)
  requireObject(cpuConfig.rental, "cpu.rental")
  const rentalConfig = cpuConfig.rental
  requirePositiveInteger(rentalConfig.min_candidate_count, "cpu.rental.min_candidate_count")
  const candidateIds = parseCandidateIds(
    rentalConfig.candidate_ids,
    syukamonData,
    "cpu.rental.candidate_ids"
  )
  if (candidateIds.length < rentalConfig.min_candidate_count) {
    throw new RangeError(
      `レンタル候補は${rentalConfig.min_candidate_count}種類以上必要です。候補数: ${candidateIds.length}`
    )
  }

  const selectedIds = selectUniqueIds(candidateIds, count, excludedIds, randomFn, "レンタルカード")
  const cards = []
  for (const id of selectedIds) {
    cards.push(createRentalCard({ id, syukamonData, battleConfig }))
  }
  return cards
}

// 全シュカモンから重複なしで指定枚数のIDを選ぶ
function selectIdsFromAllSyukamon(count, syukamonData, randomFn) {
  const catalog = createSyukamonCatalog(syukamonData)
  return selectUniqueIds([...catalog.keys()], count, [], randomFn, "通常カード")
}

// レベル範囲設定と基準レベルからカードごとの補正済みレベルを抽選する
function selectAdjustedLevel(id, baseLevel, minOffset, maxOffset, battleConfig, randomFn) {
  requireFiniteNumber(minOffset, "最小レベル補正")
  requireFiniteNumber(maxOffset, "最大レベル補正")
  const cpuConfig = getCpuConfig(battleConfig)
  requireObject(cpuConfig.level, "cpu.level")
  const randomLevel = selectRandomLevel(
    baseLevel + minOffset,
    baseLevel + maxOffset,
    cpuConfig.level.random_step,
    randomFn
  )
  return applyRareLevelAdjustment(id, randomLevel, battleConfig)
}

// 5枚の配列を右端Vから左端Zまでの固定スロットへ配置する
function assignCardsToSlots(cards) {
  if (!Array.isArray(cards) || cards.length !== DECK_CARD_COUNT) {
    throw new RangeError(`CPUデッキは${DECK_CARD_COUNT}枚である必要があります`)
  }

  const cardsBySlot = {}
  for (let index = 0; index < CARD_SLOTS.length; index += 1) {
    cardsBySlot[CARD_SLOTS[index]] = cards[index]
  }
  return cardsBySlot
}

// 難易度と5枚のカードからCPUデッキ返却値を作る
function createDeckResult(difficulty, cards) {
  requireDifficulty(difficulty)
  const ids = new Set()
  for (const card of cards) {
    if (ids.has(card.id)) throw new Error(`CPUデッキ内でシュカモンID ${card.id} が重複しています`)
    ids.add(card.id)
  }
  return { difficulty, cards: assignCardsToSlots(cards) }
}

// super_weak設定から固定レベル通常カードとレンタルカードのデッキを作る
export function buildSuperWeakDeck({ syukamonData, battleConfig, randomFn = Math.random }) {
  requireRandomFunction(randomFn)
  const cpuConfig = getCpuConfig(battleConfig)
  requireObject(cpuConfig.deck, "cpu.deck")
  requireObject(cpuConfig.deck.super_weak, "cpu.deck.super_weak")
  const deckConfig = cpuConfig.deck.super_weak
  requireNonNegativeInteger(deckConfig.card_count, "cpu.deck.super_weak.card_count")
  requireNonNegativeInteger(deckConfig.rental_count, "cpu.deck.super_weak.rental_count")
  requireFiniteNumber(deckConfig.level, "cpu.deck.super_weak.level")
  if (Math.round(deckConfig.level) <= 0 || deckConfig.level <= 0) {
    throw new RangeError("cpu.deck.super_weak.levelは四捨五入後に1以上となる正数である必要があります")
  }
  if (deckConfig.card_count + deckConfig.rental_count !== DECK_CARD_COUNT) {
    throw new RangeError("super_weakの通常カード枚数とレンタル枚数の合計は5である必要があります")
  }

  const candidateIds = parseCandidateIds(
    deckConfig.candidate_ids,
    syukamonData,
    "cpu.deck.super_weak.candidate_ids"
  )
  const normalIds = selectUniqueIds(candidateIds, deckConfig.card_count, [], randomFn, "super_weak通常カード")
  const cards = []
  for (const id of normalIds) cards.push(createNormalCard(id, deckConfig.level, syukamonData))
  cards.push(...createRentalCards(deckConfig.rental_count, normalIds, syukamonData, battleConfig, randomFn))
  return createDeckResult("super_weak", cards)
}

// weak設定から0以下のカードをレンタルへ置き換えたデッキを作る
export function buildWeakDeck({ internalRate, syukamonData, battleConfig, randomFn = Math.random }) {
  requireRandomFunction(randomFn)
  const cpuConfig = getCpuConfig(battleConfig)
  requireObject(cpuConfig.deck, "cpu.deck")
  requireObject(cpuConfig.deck.weak, "cpu.deck.weak")
  const deckConfig = cpuConfig.deck.weak
  const baseLevel = calculateBaseLevel(internalRate, battleConfig)
  const selectedIds = selectIdsFromAllSyukamon(DECK_CARD_COUNT, syukamonData, randomFn)
  const cards = []
  const normalIds = []

  for (const id of selectedIds) {
    const adjustedLevel = selectAdjustedLevel(
      id,
      baseLevel,
      deckConfig.min_level_offset,
      deckConfig.max_level_offset,
      battleConfig,
      randomFn
    )
    if (Math.round(adjustedLevel) > 0) {
      cards.push(createNormalCard(id, adjustedLevel, syukamonData))
      normalIds.push(id)
    }
  }

  cards.push(...createRentalCards(DECK_CARD_COUNT - cards.length, normalIds, syukamonData, battleConfig, randomFn))
  return createDeckResult("weak", cards)
}

// normal設定から基準レベルの上下範囲を使った5枚の通常カードデッキを作る
export function buildNormalDeck({ internalRate, syukamonData, battleConfig, randomFn = Math.random }) {
  requireRandomFunction(randomFn)
  const cpuConfig = getCpuConfig(battleConfig)
  requireObject(cpuConfig.deck, "cpu.deck")
  requireObject(cpuConfig.deck.normal, "cpu.deck.normal")
  const limit = cpuConfig.deck.normal.level_offset_limit
  requireFiniteNumber(limit, "cpu.deck.normal.level_offset_limit")
  if (limit < 0) throw new RangeError("cpu.deck.normal.level_offset_limitは0以上である必要があります")

  const baseLevel = calculateBaseLevel(internalRate, battleConfig)
  const selectedIds = selectIdsFromAllSyukamon(DECK_CARD_COUNT, syukamonData, randomFn)
  const cards = []
  for (const id of selectedIds) {
    const adjustedLevel = selectAdjustedLevel(id, baseLevel, -limit, limit, battleConfig, randomFn)
    // usableLevelには、四捨五入結果が0以下の場合だけレベル1へ補正した値を格納する
    const usableLevel = Math.round(adjustedLevel) <= 0 ? 1 : adjustedLevel
    cards.push(createNormalCard(id, usableLevel, syukamonData))
  }
  return createDeckResult("normal", cards)
}

// hard設定から基準レベル以上の範囲を使った5枚の通常カードデッキを作る
export function buildHardDeck({ internalRate, syukamonData, battleConfig, randomFn = Math.random }) {
  requireRandomFunction(randomFn)
  const cpuConfig = getCpuConfig(battleConfig)
  requireObject(cpuConfig.deck, "cpu.deck")
  requireObject(cpuConfig.deck.hard, "cpu.deck.hard")
  const deckConfig = cpuConfig.deck.hard
  const baseLevel = calculateBaseLevel(internalRate, battleConfig)
  const selectedIds = selectIdsFromAllSyukamon(DECK_CARD_COUNT, syukamonData, randomFn)
  const cards = []

  for (const id of selectedIds) {
    const adjustedLevel = selectAdjustedLevel(
      id,
      baseLevel,
      deckConfig.min_level_offset,
      deckConfig.max_level_offset,
      battleConfig,
      randomFn
    )
    // usableLevelには、四捨五入結果が0以下の場合だけレベル1へ補正した値を格納する
    const usableLevel = Math.round(adjustedLevel) <= 0 ? 1 : adjustedLevel
    cards.push(createNormalCard(id, usableLevel, syukamonData))
  }
  return createDeckResult("hard", cards)
}

// super_hard設定から先頭の高補正カードと残りの通常補正カードを作る
export function buildSuperHardDeck({ internalRate, syukamonData, battleConfig, randomFn = Math.random }) {
  requireRandomFunction(randomFn)
  const cpuConfig = getCpuConfig(battleConfig)
  requireObject(cpuConfig.deck, "cpu.deck")
  requireObject(cpuConfig.deck.super_hard, "cpu.deck.super_hard")
  const deckConfig = cpuConfig.deck.super_hard
  requireObject(deckConfig.lead_card, "cpu.deck.super_hard.lead_card")
  requireObject(deckConfig.other_cards, "cpu.deck.super_hard.other_cards")
  requireNonNegativeInteger(deckConfig.lead_card.count, "cpu.deck.super_hard.lead_card.count")
  requireNonNegativeInteger(deckConfig.other_cards.count, "cpu.deck.super_hard.other_cards.count")
  requireFiniteNumber(deckConfig.lead_card.level_offset, "cpu.deck.super_hard.lead_card.level_offset")
  requireFiniteNumber(deckConfig.other_cards.level_offset, "cpu.deck.super_hard.other_cards.level_offset")
  if (deckConfig.lead_card.count + deckConfig.other_cards.count !== DECK_CARD_COUNT) {
    throw new RangeError("super_hardのlead_card.countとother_cards.countの合計は5である必要があります")
  }

  const baseLevel = calculateBaseLevel(internalRate, battleConfig)
  const selectedIds = selectIdsFromAllSyukamon(DECK_CARD_COUNT, syukamonData, randomFn)
  const cards = []
  for (let index = 0; index < selectedIds.length; index += 1) {
    const id = selectedIds[index]
    // levelOffsetには、先頭カード群または残りカード群へ加える設定値を格納する
    const levelOffset = index < deckConfig.lead_card.count
      ? deckConfig.lead_card.level_offset
      : deckConfig.other_cards.level_offset
    const adjustedLevel = applyRareLevelAdjustment(id, baseLevel + levelOffset, battleConfig)
    // usableLevelには、四捨五入結果が0以下の場合だけレベル1へ補正した値を格納する
    const usableLevel = Math.round(adjustedLevel) <= 0 ? 1 : adjustedLevel
    cards.push(createNormalCard(id, usableLevel, syukamonData))
  }
  return createDeckResult("super_hard", cards)
}

// 難易度名に対応する個別デッキ生成関数を呼び出す
export function buildCpuDeck({ difficulty, internalRate, syukamonData, battleConfig, randomFn = Math.random }) {
  requireDifficulty(difficulty)
  const args = { internalRate, syukamonData, battleConfig, randomFn }
  if (difficulty === "super_weak") return buildSuperWeakDeck(args)
  if (difficulty === "weak") return buildWeakDeck(args)
  if (difficulty === "normal") return buildNormalDeck(args)
  if (difficulty === "hard") return buildHardDeck(args)
  return buildSuperHardDeck(args)
}

// BattleSessionで確定済みの難易度を使い、CPUデッキだけを生成する
export function createCpuDeck({ difficulty, internalRate, syukamonData, battleConfig, randomFn = Math.random }) {
  return buildCpuDeck({ difficulty, internalRate, syukamonData, battleConfig, randomFn })
}
