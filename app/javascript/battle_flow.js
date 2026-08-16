import {
  applyPendingRevengeBuffs,
  canAttack,
  createBattleCard,
  determineFirstAttacker,
  hasAttributeAdvantage,
  hasBattleableCard,
  previewAttack,
  resolveAttack
} from "./battle_engine.js"
import { createCpuDeck, createRentalCards } from "./battle_cpu_deck.js"
import { selectRandomCpuCard } from "./battle_cpu_ai.js"
import {
  EMPTY_LOCAL_DECK,
  localDeckIsValid,
  readLocalDeck
} from "./battle_deck_storage.js"
import {
  animateNumberChange,
  coverCard,
  dimCardsForChoice,
  fadeDefeatedCard,
  hideCardChoice,
  moveCardToBattle,
  moveCardToHand,
  playAttackMotion,
  playBattleStart,
  playCardEntry,
  playHitShake,
  playRevengeBuff,
  restoreHandCards,
  retreatHandCards,
  revealCard,
  showCardChoice,
  showBattleStatus,
  showDamageNumber
} from "./battle_animation.js"
import { playBattleCutIn, playDefeatEffect, playHitEffect } from "./battle_effects.js"
import {
  nicknameForDialogue,
  replaceNicknamePlaceholder
} from "./nickname_dialogue.js"
import {
  animateHpBar,
  animateMobileCardHudHp,
  BATTLE_PREPARATION_FAILURE_CLASSIFICATIONS,
  beginBattleEntryCoverFade,
  classifyBattleViewPreparationError,
  finishBattleEntryCover,
  getBattlePageUiElements,
  getBattleUiElements,
  getCardElement,
  getMobileHudElements,
  getStatusElements,
  prepareBattleView,
  renderBattleResult,
  renderBattleDecks,
  setBattleScreenAvailability,
  setupBattleSurrenderDialog,
  setCardBattleState,
  setCardInteractionEnabled,
  setMobileCardHudVisible,
  setCardSelectionState,
  setResultSavingState,
  showBattlePreparationError,
  syncDefeatEffectLayer,
  validateBattleMobileConfig,
  waitForUserCardSelection
} from "./battle_dom.js"

const BOOTSTRAP_ELEMENT_ID = "battle-bootstrap-data"
const USER_SLOTS = ["A", "B", "C", "D", "E"]
const BATTLE_ENTRY_COVER_HOLD_MS = 100

let battleContext = null
let battleResult = null
let activeBattleContext = null
let pageInitialized = false
const pageBattleLifecycle = { promise: null }

export class BattlePreparationFailure extends Error {
  constructor(error, { classification, attempts }) {
    super(error instanceof Error ? error.message : "バトル事前準備に失敗しました")
    this.name = "BattlePreparationFailure"
    this.classification = classification
    this.attempts = attempts
    this.cause = error
  }
}

export async function prepareBattleViewWithRetry({
  prepareBattleViewFn,
  battleUi,
  documentRef,
  logger = console
}) {
  requireFunction(prepareBattleViewFn, "prepareBattleViewFn")

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      // 失敗済みPromiseを再利用せず、attemptごとにprepare処理そのものを新しく呼び出す。
      return await prepareBattleViewFn({ battleUi, documentRef, logger })
    } catch (error) {
      const classification = classifyBattleViewPreparationError(error)
      const retryable = classification === BATTLE_PREPARATION_FAILURE_CLASSIFICATIONS.RETRYABLE

      if (retryable && attempt === 1) {
        // 重度な失敗（一時的な表示サイズ未確定・1回だけ再試行）:
        // 表示サイズ未確定だけは描画境界を含むprepare全体を1回だけ再実行する。
        logger.warn?.("バトル事前準備: 一時的な表示サイズ未確定として再試行します", {
          classification,
          attempt,
          element: error?.elementLabel ?? null
        }, error)
        continue
      }

      // 重度な失敗（再読み込みでも治らなさそう）:
      // 契約違反は即停止し、再試行対象も2回目の失敗後は戦闘を開始しない。
      throw new BattlePreparationFailure(error, { classification, attempts: attempt })
    }
  }

  throw new Error("バトル事前準備: 到達不能な再試行状態です")
}

const DEFAULT_BATTLE_SERVICES = Object.freeze({
  animateHpBar,
  animateMobileCardHudHp,
  animateNumberChange,
  beginBattleEntryCoverFade,
  applyPendingRevengeBuffs,
  canAttack,
  coverCard,
  dimCardsForChoice,
  determineFirstAttacker,
  fadeDefeatedCard,
  finishBattleEntryCover,
  getBattleUiElements,
  getCardElement,
  getMobileHudElements,
  getStatusElements,
  hasAttributeAdvantage,
  hasBattleableCard,
  hideCardChoice,
  moveCardToBattle,
  moveCardToHand,
  playAttackMotion,
  playBattleCutIn,
  playBattleStart,
  playCardEntry,
  playDefeatEffect,
  playHitEffect,
  playHitShake,
  playRevengeBuff,
  previewAttack,
  resolveAttack,
  restoreHandCards,
  retreatHandCards,
  revealCard,
  selectRandomCpuCard,
  setCardBattleState,
  setCardInteractionEnabled,
  setMobileCardHudVisible,
  setCardSelectionState,
  syncDefeatEffectLayer,
  showCardChoice,
  showBattleStatus,
  showDamageNumber,
  wait: waitForBattleDelay,
  waitForUserCardSelection
})

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label}はオブジェクトである必要があります`)
  }

  return value
}

function requireRate(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label}は0以上の整数である必要があります`)
  }

  return value
}

function createAbortError() {
  const error = new Error("通常戦闘が中断されました")
  error.name = "AbortError"
  return error
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError()
}

function requireDuration(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label}は0以上の整数である必要があります`)
  }

  return value
}

function requireFunction(value, label) {
  if (typeof value !== "function") {
    throw new TypeError(`${label}は関数である必要があります`)
  }

  return value
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label}は空でない文字列である必要があります`)
  }
  return value.trim()
}

function battleServices(overrides = {}) {
  return { ...DEFAULT_BATTLE_SERVICES, ...requireObject(overrides, "services") }
}

function contextRoot(context) {
  if (context?.root !== undefined) return context.root
  if (typeof document !== "undefined") return document
  throw new Error("通常戦闘: DOM rootがありません")
}

function teamCards(context, team) {
  const cards = team === "user" ? context?.userCards : team === "enemy" ? context?.enemyCards : null
  return Object.values(requireObject(cards, `${team}Cards`))
}

function findCardSlot(cards, targetCard, team) {
  const matches = Object.entries(requireObject(cards, `${team}Cards`))
    .filter(([, card]) => card === targetCard)
  if (matches.length !== 1) {
    throw new Error(`通常戦闘: ${team}の選択カードに対応するスロットが1件ではありません`)
  }

  return matches[0][0]
}

function getAttackWaitDuration(context, order) {
  const attackWait = requireObject(context?.config?.animations?.attack_wait, "animations.attack_wait")
  const orderConfig = requireObject(attackWait[order], `animations.attack_wait.${order}`)
  return requireDuration(orderConfig.duration_ms, `animations.attack_wait.${order}.duration_ms`)
}

export function waitForBattleDelay(durationMs, signal = null) {
  requireDuration(durationMs, "待機時間")
  throwIfAborted(signal)

  return new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, durationMs)
    const onAbort = () => {
      globalThis.clearTimeout(timeoutId)
      signal?.removeEventListener("abort", onAbort)
      reject(createAbortError())
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

async function runStep(action, signal) {
  throwIfAborted(signal)
  const value = await requireFunction(action, "戦闘処理")()
  throwIfAborted(signal)
  return value
}

function cardDom({ root, team, slot, card, services }) {
  const cardElement = services.getCardElement(root, team, slot)
  if (cardElement.dataset.cardId !== String(card.id)) {
    throw new Error(`通常戦闘: ${team}/${slot}のカードIDが状態と一致しません`)
  }
  if (cardElement.dataset.canBattle !== String(card.canBattle === true)) {
    throw new Error(`通常戦闘: ${team}/${slot}の戦闘可否が状態と一致しません`)
  }

  const statusElements = services.getStatusElements(root, team, slot)
  return { cardElement, statusElements }
}

function resultCard(team, slot, card) {
  return { team, slot, cardId: card.id }
}

function completedBattleResult({ winner, lastAttacker, lastDefeated, finalAttackResult, context }) {
  return {
    status: "completed",
    winner,
    lastAttacker,
    lastDefeated,
    finalAttackResult,
    userCards: context.userCards,
    enemyCards: context.enemyCards
  }
}

function cancelledBattleResult(context) {
  return {
    status: "cancelled",
    winner: null,
    userCards: context.userCards,
    enemyCards: context.enemyCards
  }
}

function surrenderedBattleResult(context) {
  return {
    ...completedBattleResult({
      winner: "enemy",
      lastAttacker: null,
      lastDefeated: null,
      finalAttackResult: null,
      context
    }),
    reason: "surrender"
  }
}

function createSyukamonIdSet(syukamonData) {
  requireObject(syukamonData, "syukamonData")
  const ids = new Set()

  for (const cardData of Object.values(syukamonData)) {
    requireObject(cardData, "シュカモンデータ")
    if (!Number.isInteger(cardData.id) || cardData.id <= 0) {
      throw new RangeError("syukamonDataのカードIDは正の整数である必要があります")
    }
    if (ids.has(cardData.id)) {
      throw new Error(`syukamonDataでカードID ${cardData.id} が重複しています`)
    }
    ids.add(cardData.id)
  }

  return ids
}

function createOwnedCardMap(ownedCards) {
  if (!Array.isArray(ownedCards)) {
    throw new TypeError("ownedCardsは配列である必要があります")
  }

  const ownedById = new Map()
  for (const ownedCard of ownedCards) {
    requireObject(ownedCard, "所有カード")
    const { cardId, exp } = ownedCard
    if (!Number.isInteger(cardId) || cardId <= 0) {
      throw new RangeError("所有カードのcardIdは正の整数である必要があります")
    }
    if (!Number.isInteger(exp) || exp < 1) {
      throw new RangeError(`所有カードID ${cardId} のexpは1以上の整数である必要があります`)
    }
    if (ownedById.has(cardId)) {
      throw new Error(`所有カードID ${cardId} が重複しています`)
    }
    ownedById.set(cardId, ownedCard)
  }

  return ownedById
}

export { readLocalDeck }

export function prepareUserDeck({
  localDeck,
  ownedCards,
  syukamonData,
  battleConfig,
  randomFn = Math.random
}) {
  const normalizedLocalDeck = localDeckIsValid(localDeck) ? localDeck : [...EMPTY_LOCAL_DECK]
  const ownedById = createOwnedCardMap(ownedCards)
  const syukamonIds = createSyukamonIdSet(syukamonData)
  const adoptedIds = new Set()
  const cardsByIndex = Array(USER_SLOTS.length).fill(null)
  const rentalIndexes = []

  normalizedLocalDeck.forEach((cardId, index) => {
    const ownedCard = ownedById.get(cardId)
    const canAdopt = cardId > 0 &&
      ownedCard !== undefined &&
      syukamonIds.has(cardId) &&
      !adoptedIds.has(cardId)

    if (!canAdopt) {
      rentalIndexes.push(index)
      return
    }

    cardsByIndex[index] = {
      ...createBattleCard({ id: cardId, exp: ownedCard.exp }, syukamonData),
      isRental: false
    }
    adoptedIds.add(cardId)
  })

  if (rentalIndexes.length > 0) {
    const rentalCards = createRentalCards(
      rentalIndexes.length,
      [...adoptedIds],
      syukamonData,
      battleConfig,
      randomFn
    )

    rentalIndexes.forEach((cardIndex, rentalIndex) => {
      cardsByIndex[cardIndex] = rentalCards[rentalIndex]
    })
  }

  return Object.fromEntries(USER_SLOTS.map((slot, index) => [slot, cardsByIndex[index]]))
}

export function prepareCpuDeck({ difficulty, internalRate, syukamonData, battleConfig, randomFn = Math.random }) {
  return createCpuDeck({
    difficulty,
    internalRate: requireRate(internalRate, "内部レート"),
    syukamonData,
    battleConfig,
    randomFn
  })
}

export function createBattleContext({ bootstrapData, localDeck, randomFn = Math.random }) {
  const bootstrap = requireObject(bootstrapData, "bootstrapData")
  const rates = requireObject(bootstrap.rates, "bootstrapData.rates")
  const battleSession = requireObject(bootstrap.battleSession, "bootstrapData.battleSession")
  const config = requireObject(bootstrap.config, "bootstrapData.config")
  const assets = requireObject(bootstrap.assets, "bootstrapData.assets")
  const syukamonData = requireObject(config.syukamon, "bootstrapData.config.syukamon")
  const battleConfig = requireObject(config.battle, "bootstrapData.config.battle")
  requireObject(config.animations, "bootstrapData.config.animations")
  requireObject(config.effects, "bootstrapData.config.effects")
  validateBattleMobileConfig(config.mobile)
  if (typeof assets.cardBackUrl !== "string" || assets.cardBackUrl.length === 0) {
    throw new Error("bootstrapData.assets.cardBackUrlがありません")
  }
  requireObject(assets.cardImageUrls, "bootstrapData.assets.cardImageUrls")
  requireObject(assets.rentalCardImageUrls, "bootstrapData.assets.rentalCardImageUrls")
  requireObject(assets.portraitImageUrls, "bootstrapData.assets.portraitImageUrls")

  const displayRate = requireRate(rates.displayRate, "表示レート")
  const internalRate = requireRate(rates.internalRate, "内部レート")
  if (typeof battleSession.token !== "string" || battleSession.token.length === 0) {
    throw new Error("bootstrapData.battleSession.tokenがありません")
  }
  if (typeof battleSession.difficulty !== "string" || battleSession.difficulty.length === 0) {
    throw new Error("bootstrapData.battleSession.difficultyがありません")
  }
  const displayRateBeforeBattle = requireRate(
    battleSession.displayRateBeforeBattle,
    "試合前表示レート"
  )
  const displayRateWinBonus = requireRate(
    battleSession.displayRateWinBonus,
    "表示レート勝利補正"
  )
  if (displayRate !== displayRateBeforeBattle) {
    throw new Error("bootstrapData.ratesとbattleSessionの試合前表示レートが一致しません")
  }
  resultCardWidthRatio({ config: { battle: battleConfig } })
  const userCards = prepareUserDeck({
    localDeck,
    ownedCards: bootstrap.ownedCards,
    syukamonData,
    battleConfig,
    randomFn
  })
  const cpuDeck = prepareCpuDeck({
    difficulty: battleSession.difficulty,
    internalRate,
    syukamonData,
    battleConfig,
    randomFn
  })

  return {
    userCards,
    enemyCards: cpuDeck.cards,
    difficulty: cpuDeck.difficulty,
    config: {
      battle: battleConfig,
      animations: config.animations,
      effects: config.effects,
      mobile: config.mobile
    },
    assets,
    syukamonData,
    battleSession: {
      token: battleSession.token,
      difficulty: cpuDeck.difficulty,
      displayRateBeforeBattle,
      displayRateWinBonus
    },
    localDeck: [...localDeck],
    ownedCards: bootstrap.ownedCards.map((ownedCard) => ({ ...ownedCard }))
  }
}

function requireRequestEnvironment({ fetchFn, documentRef, origin }) {
  requireFunction(fetchFn, "fetchFn")
  if (documentRef === null || typeof documentRef?.querySelector !== "function") {
    throw new TypeError("documentRefはquerySelectorを持つ必要があります")
  }
  if (typeof origin !== "string" || origin.length === 0) {
    throw new TypeError("originは空でない文字列である必要があります")
  }

  const csrfToken = documentRef.querySelector('meta[name="csrf-token"]')?.content
  if (typeof csrfToken !== "string" || csrfToken.length === 0) {
    throw new Error("CSRFトークンを取得できませんでした")
  }

  return csrfToken
}

async function postBattleSessionRequest({ path, body, fetchFn, documentRef, origin }) {
  const csrfToken = requireRequestEnvironment({ fetchFn, documentRef, origin })
  const response = await fetchFn(new URL(path, origin), {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken
    },
    body: JSON.stringify(body)
  })
  const responseBody = await response.json()

  if (!response.ok) {
    throw new Error(responseBody.error || "BattleSessionの保存に失敗しました")
  }

  return requireObject(responseBody.battleSession, "response.battleSession")
}

// 通常戦闘結果はtokenと勝敗だけを送り、難易度やレート値はサーバーへ委ねる。
export function saveBattleResult({
  battleSessionToken,
  result,
  fetchFn = globalThis.fetch,
  documentRef = globalThis.document,
  origin = globalThis.location?.origin
}) {
  if (typeof battleSessionToken !== "string" || battleSessionToken.length === 0) {
    throw new TypeError("battleSessionTokenは空でない文字列である必要があります")
  }
  if (result !== "win" && result !== "lose") {
    throw new TypeError("resultはwinまたはloseである必要があります")
  }

  return postBattleSessionRequest({
    path: "/battle/session/result",
    body: { battle_session_token: battleSessionToken, result },
    fetchFn,
    documentRef,
    origin
  })
}

export function readBootstrapData(documentRef) {
  const bootstrapElement = documentRef.getElementById(BOOTSTRAP_ELEMENT_ID)
  if (bootstrapElement === null) {
    throw new Error(`バトル初期化データが見つかりません（#${BOOTSTRAP_ELEMENT_ID}）`)
  }

  try {
    return requireObject(JSON.parse(bootstrapElement.textContent), "bootstrapData")
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`バトル初期化データを解析できません: ${error.message}`)
    }
    throw error
  }
}

export function initializeBattlePage({
  documentRef = document,
  storage = localStorage,
  randomFn = Math.random
} = {}) {
  const bootstrapData = readBootstrapData(documentRef)
  const localDeck = readLocalDeck(storage)
  battleContext = createBattleContext({ bootstrapData, localDeck, randomFn })
  battleContext.root = documentRef
  renderBattleDecks({ root: documentRef, context: battleContext })
  return battleContext
}

function resultCardWidthRatio(context) {
  const section = requireObject(context?.config?.battle?.result, "battle.result")
  const ratio = section.card_width_ratio
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio <= 0) {
    throw new RangeError("battle.result.card_width_ratioは0より大きい数である必要があります")
  }
  return ratio
}

function resultOutcome(result) {
  if (result?.status !== "completed" || !["user", "enemy"].includes(result.winner)) {
    throw new Error("リザルト表示には完了済み通常戦闘の勝者が必要です")
  }
  return result.winner === "user" ? "win" : "lose"
}

function syukamonDataForCard(cardId, syukamonData) {
  const cardData = Object.values(requireObject(syukamonData, "syukamonData"))
    .find((value) => value?.id === cardId)
  if (cardData === undefined) {
    throw new Error(`リザルト表示: カードID ${cardId} のシュカモンデータがありません`)
  }
  return cardData
}

export function selectAttackCutIn({
  attackerEntry,
  defenderEntry,
  context,
  services: serviceOverrides = {}
}) {
  requireObject(attackerEntry, "attackerEntry")
  requireObject(defenderEntry, "defenderEntry")
  requireObject(context, "context")
  const services = battleServices(serviceOverrides)
  const prediction = services.previewAttack(
    attackerEntry.card,
    defenderEntry.card,
    context.config.battle
  )
  if (prediction.attackSucceeded !== true) return null

  const cardData = syukamonDataForCard(attackerEntry.card.id, context.syukamonData)
  const portraitUrl = context.assets?.portraitImageUrls?.[String(attackerEntry.card.id)]
  const cutInConfig = requireObject(context.config?.effects?.cut_in, "effects.cut_in")
  const textConfig = requireObject(cutInConfig.text, "effects.cut_in.text")

  if (prediction.defeated === true) {
    const battleableDefenders = teamCards(context, defenderEntry.team)
      .filter((card) => card.canBattle === true).length
    if (battleableDefenders < 1) {
      throw new Error("通常戦闘: 撃破予測対象チームに戦闘可能カードがありません")
    }
    const finalDefeat = battleableDefenders === 1
    const messageKey = finalDefeat ? "final_defeat" : "normal_defeat"
    // 通常撃破は最終撃破を除き、初回撃破以外の撃破タイミングでも毎回発動する。
    return {
      kind: finalDefeat ? "final-defeat" : "normal-defeat",
      team: attackerEntry.team,
      text: requireText(cardData[messageKey], `カードID ${attackerEntry.card.id} の${messageKey}`),
      portraitUrl: requireText(portraitUrl, `カードID ${attackerEntry.card.id} のポートレートURL`),
      prediction
    }
  }

  if (services.hasAttributeAdvantage(attackerEntry.card, defenderEntry.card)) {
    const messageKey = attackerEntry.team === "user" ? "user_advantage" : "enemy_advantage"
    return {
      kind: "attribute-advantage",
      team: attackerEntry.team,
      text: requireText(textConfig[messageKey], `effects.cut_in.text.${messageKey}`),
      portraitUrl: null,
      prediction
    }
  }

  return null
}

async function playAttackCutIn({ attackerEntry, defenderEntry, context, signal, services }) {
  const cutIn = selectAttackCutIn({ attackerEntry, defenderEntry, context, services })
  if (cutIn === null) return null

  await runStep(() => services.playBattleCutIn({
    team: cutIn.team,
    text: cutIn.text,
    portraitUrl: cutIn.portraitUrl,
    config: context.config.effects,
    signal,
    documentRef: contextRoot(context)
  }), signal)
  return cutIn
}

export function selectResultUserCard(userCards, randomFn = Math.random) {
  requireFunction(randomFn, "randomFn")
  const candidates = Object.entries(requireObject(userCards, "userCards"))
    .filter(([, card]) => card?.isRental === false)
  if (candidates.length === 0) return null

  const randomValue = randomFn()
  if (typeof randomValue !== "number" || !Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new RangeError("リザルトカード抽選値は0以上1未満である必要があります")
  }
  const [slot, card] = candidates[Math.floor(randomValue * candidates.length)]
  return { slot, card }
}

export function buildBattleResultViewModel({ context, result, storage, randomFn = Math.random }) {
  requireObject(context, "context")
  const outcome = resultOutcome(result)
  const rateBefore = requireRate(context.battleSession?.displayRateBeforeBattle, "試合前表示レート")
  const difficulty = context.battleSession?.difficulty
  const rateSettings = requireObject(
    context.config?.battle?.internal_rate?.difficulty?.[difficulty],
    `battle.internal_rate.difficulty.${difficulty}`
  )
  const winGain = requireRate(rateSettings.win_gain, `${difficulty}.win_gain`)
  const bonus = requireRate(context.battleSession?.displayRateWinBonus, "表示レート勝利補正")
  const rateAfter = outcome === "win" ? rateBefore + winGain + bonus : rateBefore
  const selected = selectResultUserCard(context.userCards, randomFn)
  if (selected === null) return { outcome, rateBefore, rateAfter, cardView: null }

  const cardData = syukamonDataForCard(selected.card.id, context.syukamonData)
  const message = cardData[outcome]
  if (typeof cardData.short_name !== "string" || cardData.short_name.trim() === "") {
    throw new Error(`リザルト表示: カードID ${selected.card.id} のshort_nameがありません`)
  }
  if (typeof message !== "string" || message.trim() === "") {
    throw new Error(`リザルト表示: カードID ${selected.card.id} の${outcome}セリフがありません`)
  }
  const cardImageUrl = context.assets?.cardImageUrls?.[String(selected.card.id)]
  if (typeof cardImageUrl !== "string" || cardImageUrl.length === 0) {
    throw new Error(`リザルト表示: カードID ${selected.card.id} のカード画像URLがありません`)
  }
  const nickname = nicknameForDialogue(storage)

  return {
    outcome,
    rateBefore,
    rateAfter,
    cardView: {
      cardId: selected.card.id,
      slot: selected.slot,
      name: cardData.short_name.trim(),
      cardImageUrl,
      message: replaceNicknamePlaceholder(message.trim(), nickname)
    }
  }
}

export function initializeBattleScreen({ root = document }) {
  const pageUi = getBattlePageUiElements(root)
  const battleUi = getBattleUiElements(root)
  setBattleScreenAvailability({ battleElement: battleUi.battleElement, available: true })
  pageUi.preparationErrorScreenElement.hidden = true
  pageUi.preparationErrorScreenElement.inert = true
  pageUi.preparationErrorScreenElement.setAttribute("aria-hidden", "true")
  pageUi.resultScreenElement.hidden = true
  pageUi.resultScreenElement.inert = true
  pageUi.resultScreenElement.setAttribute("aria-hidden", "true")
  return { pageUi, battleUi }
}

function requireSavedRates(savedSession) {
  const saved = requireObject(savedSession, "保存済みBattleSession")
  requireRate(saved.finalInternalRate, "保存後内部レート")
  requireRate(saved.finalDisplayRate, "保存後表示レート")
  return saved
}

export function setupBattleResultActions({
  pageUi,
  context,
  result,
  saveResultFn = saveBattleResult,
  locationRef = globalThis.location
}) {
  requireFunction(saveResultFn, "saveResultFn")
  if (typeof locationRef?.assign !== "function") {
    throw new TypeError("locationRefはassignを持つ必要があります")
  }
  const outcome = resultOutcome(result)
  const targets = {
    finish: pageUi.resultScreenElement.dataset.tasksUrl,
    rematch: pageUi.resultScreenElement.dataset.rematchUrl
  }
  if (Object.values(targets).some((url) => typeof url !== "string" || url.length === 0)) {
    throw new Error("リザルト画面の遷移先URLがありません")
  }

  let saving = false
  const listeners = []
  for (const button of pageUi.resultActionElements) {
    const action = button.dataset.battleResultAction
    if (!(action in targets)) throw new Error(`未対応のリザルト操作です: ${action}`)
    const listener = async () => {
      if (saving) return
      saving = true
      setResultSavingState(pageUi, true)
      pageUi.resultErrorElement.hidden = true
      try {
        const savedSession = await saveResultFn({
          battleSessionToken: context.battleSession.token,
          result: outcome
        })
        requireSavedRates(savedSession)
        locationRef.assign(targets[action])
      } catch (_error) {
        pageUi.resultErrorElement.hidden = false
        saving = false
        setResultSavingState(pageUi, false)
      }
    }
    button.addEventListener("click", listener)
    listeners.push([button, listener])
  }

  return () => {
    for (const [button, listener] of listeners) button.removeEventListener("click", listener)
  }
}

export function showBattleResultScreen({
  context,
  result,
  root = document,
  storage = localStorage,
  randomFn = Math.random,
  saveResultFn = saveBattleResult,
  locationRef = globalThis.location
}) {
  const pageUi = getBattlePageUiElements(root)
  const battleUi = getBattleUiElements(root)
  const battleAreaWidth = battleUi.userBattleAreaElement.getBoundingClientRect().width
  if (typeof battleAreaWidth !== "number" || !Number.isFinite(battleAreaWidth) || battleAreaWidth <= 0) {
    throw new Error("リザルト表示: 戦闘エリア横幅を取得できません")
  }
  const viewModel = buildBattleResultViewModel({ context, result, storage, randomFn })
  setBattleScreenAvailability({ battleElement: battleUi.battleElement, available: false })
  battleUi.battleElement.hidden = true
  renderBattleResult({
    ui: pageUi,
    ...viewModel,
    cardWidth: battleAreaWidth * resultCardWidthRatio(context)
  })
  setupBattleResultActions({ pageUi, context, result, saveResultFn, locationRef })
  return viewModel
}

export function startPreparedBattle({
  context,
  battleUi,
  preparationPromise = Promise.resolve(),
  lifecycle = pageBattleLifecycle,
  storage = globalThis.localStorage,
  randomFn = Math.random,
  runBattleFn = runNormalBattle,
  setupSurrenderFn = null,
  showResultFn = showBattleResultScreen,
  saveResultFn = saveBattleResult,
  locationRef = globalThis.location
}) {
  requireObject(lifecycle, "lifecycle")
  if (setupSurrenderFn !== null) requireFunction(setupSurrenderFn, "setupSurrenderFn")
  requireFunction(showResultFn, "showResultFn")
  if (lifecycle.promise !== null) return lifecycle.promise

  lifecycle.promise = (async () => {
    await preparationPromise
    const abortController = new AbortController()
    let surrenderConfirmed = false
    const surrenderControls = setupSurrenderFn === null
      ? { setVisible() {}, setEnabled() {}, finish() {}, destroy() {} }
      : setupSurrenderFn({
          root: contextRoot(context),
          battleElement: battleUi.battleElement,
          onConfirm: () => {
            if (surrenderConfirmed) return
            surrenderConfirmed = true
            abortController.abort()
          }
        })
    let surrenderControlsFinished = false
    const finishSurrenderControls = () => {
      if (surrenderControlsFinished) return
      surrenderControlsFinished = true
      surrenderControls.finish()
    }

    battleUi.battleElement.hidden = false
    setBattleScreenAvailability({ battleElement: battleUi.battleElement, available: true })
    surrenderControls.setVisible(true)
    surrenderControls.setEnabled(false)
    try {
      battleResult = await runBattleFn(context, {
        randomFn,
        signal: abortController.signal,
        onSurrenderAvailabilityChange: (available) => surrenderControls.setEnabled(available)
      })
      if (surrenderConfirmed) {
        if (battleResult.status !== "cancelled") {
          throw new Error("降参による中断結果が通常戦闘の契約と一致しません")
        }
        battleResult = surrenderedBattleResult(context)
      }
      finishSurrenderControls()
      if (battleResult.status === "completed") {
        showResultFn({
          context,
          result: battleResult,
          root: contextRoot(context),
          storage,
          randomFn,
          saveResultFn,
          locationRef
        })
      }
      return battleResult
    } finally {
      finishSurrenderControls()
      surrenderControls.destroy()
    }
  })()

  return lifecycle.promise
}

export async function executeSingleAttack({
  attacker,
  defender,
  attackerTeam,
  defenderTeam,
  attackerSlot,
  defenderSlot,
  context,
  signal = null,
  services: serviceOverrides = {}
}) {
  const services = battleServices(serviceOverrides)
  const root = contextRoot(context)
  const attackerDom = cardDom({ root, team: attackerTeam, slot: attackerSlot, card: attacker, services })
  const defenderDom = cardDom({ root, team: defenderTeam, slot: defenderSlot, card: defender, services })
  throwIfAborted(signal)

  if (!services.canAttack(attacker, defender)) {
    return {
      attackSucceeded: false,
      damage: 0,
      defeated: false,
      defenderHpBefore: defender.currentHp,
      defenderHpAfter: defender.currentHp,
      attackerSpdBefore: attacker.currentSpd,
      attackerSpdAfter: attacker.currentSpd
    }
  }

  const shadowElement = attackerDom.cardElement.querySelector("[data-battle-animation-shadow]")
  if (shadowElement === null) {
    throw new Error(`通常戦闘: ${attackerTeam}/${attackerSlot}の攻撃用影がありません`)
  }

  let impactCount = 0
  let resolveCount = 0
  let attackResult = null
  services.setMobileCardHudVisible({ root, team: attackerTeam, slot: attackerSlot, visible: false })
  try {
    await runStep(() => services.playAttackMotion({
      cardElement: attackerDom.cardElement,
      shadowElement,
      team: attackerTeam,
      config: context.config.animations,
      signal,
      onImpact: async () => {
        impactCount += 1
        if (impactCount !== 1) {
          throw new Error("通常戦闘: onImpactが複数回発火しました")
        }
        throwIfAborted(signal)

        resolveCount += 1
        if (resolveCount !== 1) {
          throw new Error("通常戦闘: resolveAttackを複数回実行しようとしました")
        }
        attackResult = services.resolveAttack(attacker, defender, context.config.battle)
        if (attackResult.attackSucceeded !== true) {
          throw new Error("通常戦闘: 攻撃モーション開始後に攻撃不成立へ変化しました")
        }

        await Promise.all([
          services.playHitEffect(defenderDom.cardElement, attacker.type, context.config.effects),
          services.playHitShake({
            cardElement: defenderDom.cardElement,
            team: defenderTeam,
            config: context.config.animations
          }),
          services.showDamageNumber({
            cardElement: defenderDom.cardElement,
            damage: attackResult.damage,
            team: defenderTeam,
            config: context.config.animations
          }),
          services.animateNumberChange({
            numberElement: defenderDom.statusElements.currentHpElement,
            fromValue: attackResult.defenderHpBefore,
            toValue: attackResult.defenderHpAfter,
            config: context.config.animations
          }),
          services.animateHpBar({
            hpFillElement: defenderDom.statusElements.hpFillElement,
            hpBefore: attackResult.defenderHpBefore,
            hpAfter: attackResult.defenderHpAfter,
            maxHp: defender.initialHp,
            config: context.config.animations.number_change
          }),
          services.animateMobileCardHudHp({
            root,
            team: defenderTeam,
            slot: defenderSlot,
            hpBefore: attackResult.defenderHpBefore,
            hpAfter: attackResult.defenderHpAfter,
            maxHp: defender.initialHp,
            config: context.config.animations
          })
        ])
        defenderDom.statusElements.hpBarElement.setAttribute(
          "aria-label",
          `現在HP ${attackResult.defenderHpAfter} / ${defender.initialHp}`
        )
        throwIfAborted(signal)
      }
    }), signal)
  } finally {
    // 攻撃成立時だけ隠し、hit effectまで完了した後に攻撃側HUDだけを戻す。
    if (!signal?.aborted && attacker.canBattle === true) {
      services.setMobileCardHudVisible({ root, team: attackerTeam, slot: attackerSlot, visible: true })
    }
  }

  if (impactCount !== 1 || resolveCount !== 1 || attackResult === null) {
    throw new Error("通常戦闘: 攻撃着地処理が正確に1回完了しませんでした")
  }

  if (attackResult.defeated) {
    const battleUi = services.getBattleUiElements(root)
    const battleAreaElement = defenderTeam === "user"
      ? battleUi.userBattleAreaElement
      : battleUi.enemyBattleAreaElement
    const defeatEffectLayerElement = defenderTeam === "user"
      ? battleUi.userDefeatEffectLayerElement
      : battleUi.enemyDefeatEffectLayerElement
    services.syncDefeatEffectLayer({
      battleElement: battleUi.battleElement,
      battleAreaElement,
      effectLayerElement: defeatEffectLayerElement
    })
    await runStep(() => Promise.all([
      services.playDefeatEffect(defeatEffectLayerElement, context.config.effects),
      services.fadeDefeatedCard({
        cardElement: defenderDom.cardElement,
        team: defenderTeam,
        config: context.config.animations
      })
    ]), signal)
    services.setCardBattleState({ root, team: defenderTeam, slot: defenderSlot, canBattle: false })
  }

  return attackResult
}

export async function executeCombatPair({
  first,
  second,
  context,
  signal = null,
  services: serviceOverrides = {}
}) {
  const services = battleServices({ wait: waitForBattleDelay, ...serviceOverrides })
  const records = []

  const execute = async (attackerEntry, defenderEntry) => {
    const result = await executeSingleAttack({
      attacker: attackerEntry.card,
      defender: defenderEntry.card,
      attackerTeam: attackerEntry.team,
      defenderTeam: defenderEntry.team,
      attackerSlot: attackerEntry.slot,
      defenderSlot: defenderEntry.slot,
      context,
      signal,
      services
    })
    records.push({
      attacker: attackerEntry.card,
      attackerTeam: attackerEntry.team,
      attackerSlot: attackerEntry.slot,
      defender: defenderEntry.card,
      defenderTeam: defenderEntry.team,
      defenderSlot: defenderEntry.slot,
      result
    })
    return result
  }

  await services.wait(getAttackWaitDuration(context, "first"), signal)
  throwIfAborted(signal)
  await playAttackCutIn({
    attackerEntry: first,
    defenderEntry: second,
    context,
    signal,
    services
  })
  const firstResult = await execute(first, second)
  if (!services.hasBattleableCard(teamCards(context, second.team))) {
    return {
      completed: true,
      winner: first.team,
      lastAttacker: resultCard(first.team, first.slot, first.card),
      lastDefeated: resultCard(second.team, second.slot, second.card),
      finalAttackResult: firstResult,
      records
    }
  }

  if (second.card.canBattle === true) {
    await services.wait(getAttackWaitDuration(context, "second"), signal)
    throwIfAborted(signal)
    await playAttackCutIn({
      attackerEntry: second,
      defenderEntry: first,
      context,
      signal,
      services
    })
    const secondResult = await execute(second, first)
    if (!services.hasBattleableCard(teamCards(context, first.team))) {
      return {
        completed: true,
        winner: second.team,
        lastAttacker: resultCard(second.team, second.slot, second.card),
        lastDefeated: resultCard(first.team, first.slot, first.card),
        finalAttackResult: secondResult,
        records
      }
    }
  }

  return { completed: false, records }
}

async function returnDeployedCards({ userEntry, enemyEntry, context, signal, services }) {
  const root = contextRoot(context)
  const userDom = cardDom({ root, team: "user", slot: userEntry.slot, card: userEntry.card, services })
  const enemyDom = cardDom({ root, team: "enemy", slot: enemyEntry.slot, card: enemyEntry.card, services })
  const userOtherCards = USER_SLOTS
    .filter((slot) => slot !== userEntry.slot && context.userCards[slot].canBattle === true)
    .map((slot) => services.getCardElement(root, "user", slot))
  const enemyOtherCards = Object.keys(context.enemyCards)
    .filter((slot) => slot !== enemyEntry.slot && context.enemyCards[slot].canBattle === true)
    .map((slot) => services.getCardElement(root, "enemy", slot))

  services.setMobileCardHudVisible({ root, team: "user", slot: userEntry.slot, visible: false })
  services.setMobileCardHudVisible({ root, team: "enemy", slot: enemyEntry.slot, visible: false })

  await runStep(() => Promise.all([
    services.moveCardToHand({
      cardElement: userDom.cardElement,
      team: "user",
      handStatusElement: userDom.statusElements.statusElement,
      battleStatusElement: userDom.statusElements.statusElement,
      config: context.config.animations
    }),
    services.moveCardToHand({
      cardElement: enemyDom.cardElement,
      team: "enemy",
      handStatusElement: enemyDom.statusElements.statusElement,
      battleStatusElement: enemyDom.statusElements.statusElement,
      config: context.config.animations
    }),
    services.restoreHandCards({ cardElements: userOtherCards, team: "user", config: context.config.animations }),
    services.restoreHandCards({ cardElements: enemyOtherCards, team: "enemy", config: context.config.animations })
  ]), signal)

  for (const entry of [userEntry, enemyEntry]) {
    const cardElement = services.getCardElement(root, entry.team, entry.slot)
    services.setCardSelectionState(cardElement, { selected: false, deployed: false })
    services.setCardInteractionEnabled(cardElement, false)
    services.setMobileCardHudVisible({
      root,
      team: entry.team,
      slot: entry.slot,
      visible: entry.card.canBattle === true
    })
  }
}

function snapshotTeamStats(cards) {
  return new Map(Object.entries(cards).map(([slot, card]) => [slot, {
    currentHp: card.currentHp,
    currentAtk: card.currentAtk,
    currentSpd: card.currentSpd
  }]))
}

async function animateRevengeChanges({ team, cards, before, context, signal, services }) {
  const root = contextRoot(context)
  const animations = []

  for (const [slot, card] of Object.entries(cards)) {
    if (card.canBattle !== true) continue
    const previous = before.get(slot)
    const hpChanged = previous.currentHp !== card.currentHp
    const atkChanged = previous.currentAtk !== card.currentAtk
    const spdChanged = previous.currentSpd !== card.currentSpd
    if (!hpChanged && !atkChanged && !spdChanged) continue

    const cardElement = services.getCardElement(root, team, slot)
    const status = services.getStatusElements(root, team, slot)
    const cardAnimations = [services.playRevengeBuff({
      cardElement,
      team,
      config: context.config.animations
    })]

    if (hpChanged) {
      cardAnimations.push(
        services.animateNumberChange({
          numberElement: status.currentHpElement,
          fromValue: previous.currentHp,
          toValue: card.currentHp,
          config: context.config.animations
        }),
        services.animateHpBar({
          hpFillElement: status.hpFillElement,
          hpBefore: previous.currentHp,
          hpAfter: card.currentHp,
          maxHp: card.initialHp,
          config: context.config.animations.number_change
        }),
        services.animateMobileCardHudHp({
          root,
          team,
          slot,
          hpBefore: previous.currentHp,
          hpAfter: card.currentHp,
          maxHp: card.initialHp,
          config: context.config.animations
        })
      )
      status.hpBarElement.setAttribute("aria-label", `現在HP ${card.currentHp} / ${card.initialHp}`)
    }
    animations.push(Promise.all(cardAnimations))
  }

  await runStep(() => Promise.all(animations), signal)
}

export async function applyRevengeBuffsForTurn({
  context,
  signal = null,
  services: serviceOverrides = {}
}) {
  const services = battleServices(serviceOverrides)
  const userBefore = snapshotTeamStats(context.userCards)
  const enemyBefore = snapshotTeamStats(context.enemyCards)
  services.applyPendingRevengeBuffs(teamCards(context, "user"))
  services.applyPendingRevengeBuffs(teamCards(context, "enemy"))
  throwIfAborted(signal)

  await Promise.all([
    animateRevengeChanges({
      team: "user",
      cards: context.userCards,
      before: userBefore,
      context,
      signal,
      services
    }),
    animateRevengeChanges({
      team: "enemy",
      cards: context.enemyCards,
      before: enemyBefore,
      context,
      signal,
      services
    })
  ])
}

export async function runNormalTurn({
  context,
  signal = null,
  randomFn = Math.random,
  onSurrenderAvailabilityChange = () => {},
  services: serviceOverrides = {}
}) {
  requireFunction(onSurrenderAvailabilityChange, "onSurrenderAvailabilityChange")
  const services = battleServices(serviceOverrides)
  const root = contextRoot(context)
  const ui = services.getBattleUiElements(root)
  throwIfAborted(signal)

  const enemyChoiceCardElements = Object.entries(context.enemyCards)
    .filter(([, card]) => card.canBattle === true)
    .map(([slot]) => services.getCardElement(root, "enemy", slot))

  await runStep(() => Promise.all([
    services.showCardChoice({
      dimElement: ui.choiceDimElement,
      promptElement: ui.choicePromptElement,
      config: context.config.animations
    }),
    services.dimCardsForChoice({
      cardElements: enemyChoiceCardElements,
      config: context.config.animations
    })
  ]), signal)

  let userEntry
  try {
    onSurrenderAvailabilityChange(true)
    userEntry = await services.waitForUserCardSelection({
      root,
      userCards: context.userCards,
      battleAreaElement: ui.userBattleAreaElement,
      config: context.config.animations,
      signal,
      onBusyChange: (busy) => onSurrenderAvailabilityChange(!busy)
    })
    throwIfAborted(signal)
  } finally {
    onSurrenderAvailabilityChange(false)
    services.hideCardChoice({
      dimElement: ui.choiceDimElement,
      promptElement: ui.choicePromptElement
    })
  }

  const enemyCard = services.selectRandomCpuCard(context.enemyCards, context.difficulty, randomFn)
  if (enemyCard === null) {
    if (services.hasBattleableCard(teamCards(context, "enemy"))) {
      throw new Error("通常戦闘: 生存CPUカードがあるのにCPU選択がnullでした")
    }
    return completedBattleResult({
      winner: "user",
      lastAttacker: null,
      lastDefeated: null,
      finalAttackResult: null,
      context
    })
  }
  if (enemyCard.canBattle !== true) {
    throw new Error("通常戦闘: CPUが戦闘不能カードを選択しました")
  }
  const enemySlot = findCardSlot(context.enemyCards, enemyCard, "enemy")
  const enemyEntry = { team: "enemy", slot: enemySlot, card: enemyCard }
  userEntry = { ...userEntry, team: "user" }

  const userDom = cardDom({ root, team: "user", slot: userEntry.slot, card: userEntry.card, services })
  const enemyDom = cardDom({ root, team: "enemy", slot: enemySlot, card: enemyCard, services })
  services.setCardSelectionState(enemyDom.cardElement, { selected: true, deployed: true })
  services.setCardInteractionEnabled(enemyDom.cardElement, false)
  const userBattleableCards = USER_SLOTS
    .filter((slot) => context.userCards[slot].canBattle === true)
    .map((slot) => services.getCardElement(root, "user", slot))
  const enemyBattleableCards = Object.keys(context.enemyCards)
    .filter((slot) => context.enemyCards[slot].canBattle === true)
    .map((slot) => services.getCardElement(root, "enemy", slot))
  const userReferenceCardElement = userBattleableCards[0]
  if (userReferenceCardElement === undefined) {
    throw new Error("通常戦闘: 退避距離とエネミーサイズの基準となるユーザーカードがありません")
  }

  services.setMobileCardHudVisible({ root, team: "user", slot: userEntry.slot, visible: false })
  services.setMobileCardHudVisible({ root, team: "enemy", slot: enemyEntry.slot, visible: false })

  await runStep(() => Promise.all([
    ...userBattleableCards.map((cardElement) => services.coverCard({
      cardElement,
      team: "user",
      cardBackUrl: context.assets.cardBackUrl,
      config: context.config.animations
    })),
    ...enemyBattleableCards.map((cardElement) => services.coverCard({
      cardElement,
      team: "enemy",
      cardBackUrl: context.assets.cardBackUrl,
      config: context.config.animations
    })),
    services.retreatHandCards({
      cardElements: userBattleableCards,
      team: "user",
      userReferenceCardElement,
      config: context.config.animations
    }),
    services.retreatHandCards({
      cardElements: enemyBattleableCards,
      team: "enemy",
      userReferenceCardElement,
      config: context.config.animations
    })
  ]), signal)

  await runStep(() => Promise.all([
    services.moveCardToBattle({
      cardElement: userDom.cardElement,
      team: "user",
      battleAreaElement: ui.userBattleAreaElement,
      handStatusElement: userDom.statusElements.statusElement,
      battleStatusElement: userDom.statusElements.statusElement,
      battleStatusContainerElement: ui.userBattleStatusAnchorElement,
      config: context.config.animations
    }),
    services.moveCardToBattle({
      cardElement: enemyDom.cardElement,
      team: "enemy",
      battleAreaElement: ui.enemyBattleAreaElement,
      handStatusElement: enemyDom.statusElements.statusElement,
      battleStatusElement: enemyDom.statusElements.statusElement,
      battleStatusContainerElement: ui.enemyBattleStatusAnchorElement,
      userReferenceCardElement,
      config: context.config.animations
    })
  ]), signal)

  await runStep(() => Promise.all([
    services.revealCard({ cardElement: userDom.cardElement, team: "user", config: context.config.animations }),
    services.revealCard({ cardElement: enemyDom.cardElement, team: "enemy", config: context.config.animations })
  ]), signal)

  services.setMobileCardHudVisible({ root, team: "user", slot: userEntry.slot, visible: true })
  services.setMobileCardHudVisible({ root, team: "enemy", slot: enemyEntry.slot, visible: true })

  await runStep(() => Promise.all([
    services.showBattleStatus({
      battleStatusElement: userDom.statusElements.statusElement,
      config: context.config.animations
    }),
    services.showBattleStatus({
      battleStatusElement: enemyDom.statusElements.statusElement,
      config: context.config.animations
    })
  ]), signal)

  const firstTeam = services.determineFirstAttacker(userEntry.card, enemyEntry.card, randomFn)
  const first = firstTeam === "user" ? userEntry : enemyEntry
  const second = firstTeam === "user" ? enemyEntry : userEntry
  const combat = await executeCombatPair({ first, second, context, signal, services })
  if (combat.completed) {
    return completedBattleResult({ ...combat, context })
  }

  await returnDeployedCards({ userEntry, enemyEntry, context, signal, services })
  await applyRevengeBuffsForTurn({ context, signal, services })
  return { status: "turn-completed", userEntry, enemyEntry, combat }
}

function setUserInteractionForBattle(context, services, enabled) {
  const root = contextRoot(context)
  for (const [slot, card] of Object.entries(context.userCards)) {
    const cardElement = services.getCardElement(root, "user", slot)
    services.setCardInteractionEnabled(cardElement, enabled && card.canBattle === true)
  }
}

export async function runNormalBattle(
  context,
  {
    signal = null,
    randomFn = Math.random,
    onSurrenderAvailabilityChange = () => {},
    services: serviceOverrides = {}
  } = {}
) {
  requireObject(context, "context")
  requireFunction(randomFn, "randomFn")
  requireFunction(onSurrenderAvailabilityChange, "onSurrenderAvailabilityChange")
  if (activeBattleContext !== null) {
    throw new Error("通常戦闘は既に実行中です")
  }

  const services = battleServices(serviceOverrides)
  const root = contextRoot(context)
  const ui = services.getBattleUiElements(root)
  getAttackWaitDuration(context, "first")
  getAttackWaitDuration(context, "second")
  activeBattleContext = context

  try {
    onSurrenderAvailabilityChange(false)
    throwIfAborted(signal)
    setUserInteractionForBattle(context, services, false)

    await services.wait(BATTLE_ENTRY_COVER_HOLD_MS, signal)
    throwIfAborted(signal)
    const cardEntryDuration = requireDuration(
      context.config.animations?.card_entry?.duration_ms,
      "animations.card_entry.duration_ms"
    )
    services.beginBattleEntryCoverFade({
      coverElement: ui.entryCoverElement,
      durationMs: cardEntryDuration
    })

    await runStep(() => Promise.all([
      ...Object.keys(context.userCards).map((slot) => services.playCardEntry({
        cardElement: services.getCardElement(root, "user", slot),
        team: "user",
        config: context.config.animations
      })),
      ...Object.keys(context.enemyCards).map((slot) => services.playCardEntry({
        cardElement: services.getCardElement(root, "enemy", slot),
        team: "enemy",
        config: context.config.animations
      })),
      services.wait(cardEntryDuration, signal)
    ]), signal)
    services.finishBattleEntryCover({ coverElement: ui.entryCoverElement })
    await runStep(() => services.playBattleStart({
      messageElement: ui.battleStartElement,
      config: context.config.animations
    }), signal)

    while (
      services.hasBattleableCard(teamCards(context, "user")) &&
      services.hasBattleableCard(teamCards(context, "enemy"))
    ) {
      throwIfAborted(signal)
      const turnResult = await runNormalTurn({
        context,
        signal,
        randomFn,
        onSurrenderAvailabilityChange,
        services
      })
      if (turnResult.status === "completed") {
        setUserInteractionForBattle(context, services, false)
        return turnResult
      }
    }

    const userAlive = services.hasBattleableCard(teamCards(context, "user"))
    const enemyAlive = services.hasBattleableCard(teamCards(context, "enemy"))
    if (userAlive === enemyAlive) {
      throw new Error("通常戦闘: 勝者を一意に決定できません")
    }
    setUserInteractionForBattle(context, services, false)
    return completedBattleResult({
      winner: userAlive ? "user" : "enemy",
      lastAttacker: null,
      lastDefeated: null,
      finalAttackResult: null,
      context
    })
  } catch (error) {
    services.finishBattleEntryCover({ coverElement: ui.entryCoverElement })
    services.hideCardChoice({
      dimElement: ui.choiceDimElement,
      promptElement: ui.choicePromptElement
    })
    if (error?.name === "AbortError") {
      setUserInteractionForBattle(context, services, false)
      return cancelledBattleResult(context)
    }

    setUserInteractionForBattle(context, services, true)
    throw error
  } finally {
    onSurrenderAvailabilityChange(false)
    activeBattleContext = null
  }
}

export function getBattleContext() {
  return battleContext
}

export function getBattleResult() {
  return battleResult
}

export function initializeBattleApplication({
  documentRef = document,
  storage = localStorage,
  locationRef = globalThis.location,
  randomFn = Math.random,
  lifecycle = pageBattleLifecycle,
  runBattleFn = runNormalBattle,
  prepareBattleViewFn = prepareBattleView,
  saveResultFn = saveBattleResult,
  errorHandler = (error) => console.error("通常戦闘を開始できませんでした", error)
} = {}) {
  requireFunction(errorHandler, "errorHandler")
  requireFunction(prepareBattleViewFn, "prepareBattleViewFn")
  const context = initializeBattlePage({ documentRef, storage, randomFn })
  const { pageUi, battleUi } = initializeBattleScreen({ root: documentRef })
  const preparationPromise = prepareBattleViewWithRetry({
    prepareBattleViewFn,
    battleUi,
    documentRef
  })
  const launch = () => startPreparedBattle({
    context,
    battleUi,
    preparationPromise,
    lifecycle,
    storage,
    randomFn,
    runBattleFn,
    setupSurrenderFn: setupBattleSurrenderDialog,
    saveResultFn,
    locationRef
  })
  const launchSafely = () => launch().catch((error) => {
    if (!(error instanceof BattlePreparationFailure)) {
      errorHandler(error)
      return
    }

    console.error("バトル事前準備に失敗したため戦闘を停止しました", {
      classification: error.classification,
      attempts: error.attempts,
      element: error.cause?.elementLabel ?? null,
      code: error.cause?.code ?? null
    }, error.cause)

    try {
      showBattlePreparationError({ pageUi, battleUi })
    } catch (screenError) {
      console.error("バトル事前準備エラー画面を表示できませんでした", screenError)
    }
  })
  launchSafely()

  return { context, pageUi, battleUi, launch }
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    if (pageInitialized) {
      console.error("バトル画面を二重に初期化しようとしました")
      return
    }
    pageInitialized = true

    try {
      initializeBattleApplication()
    } catch (error) {
      console.error("バトル画面を初期化できませんでした", error)
    }
  })
}
