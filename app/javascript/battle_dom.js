import {
  animateNumberChange,
  calculateNumberChangeDuration,
  deselectCard,
  discardStatusHandPlaceholder,
  selectCard,
  validateBattleStatusConfig
} from "./battle_animation.js"

const USER_SLOTS = ["A", "B", "C", "D", "E"]
const ENEMY_SLOTS = ["V", "W", "X", "Y", "Z"]
const ENEMY_DOM_SLOTS = [...ENEMY_SLOTS].reverse()

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label}はオブジェクトである必要があります`)
  }

  return value
}

function requireElement(element, label) {
  if (element === null || element === undefined) {
    throw new Error(`バトルDOM: ${label}が見つかりません`)
  }

  return element
}

function requireFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`バトルDOM: ${label}は有限数である必要があります`)
  }

  return value
}

function requireNumberInRange(value, label, { minimum = null, maximum = null, maximumExclusive = null } = {}) {
  const number = requireFiniteNumber(value, label)
  if (minimum !== null && number < minimum) {
    throw new RangeError(`バトルDOM: ${label}は${minimum}以上である必要があります`)
  }
  if (maximum !== null && number > maximum) {
    throw new RangeError(`バトルDOM: ${label}は${maximum}以下である必要があります`)
  }
  if (maximumExclusive !== null && number >= maximumExclusive) {
    throw new RangeError(`バトルDOM: ${label}は${maximumExclusive}未満である必要があります`)
  }
  return number
}

function requirePositiveNumber(value, label) {
  const number = requireFiniteNumber(value, label)
  if (number <= 0) throw new RangeError(`バトルDOM: ${label}は0より大きい必要があります`)
  return number
}

export function validateBattleMobileConfig(config) {
  const root = requireObject(config, "mobile").battle_mobile
  const mobile = requireObject(root, "mobile.battle_mobile")
  const userHand = requireObject(mobile.user_hand, "mobile.battle_mobile.user_hand")
  const hp = requireObject(mobile.hp, "mobile.battle_mobile.hp")
  const level = requireObject(mobile.level, "mobile.battle_mobile.level")
  const battleArea = requireObject(mobile.battle_area, "mobile.battle_mobile.battle_area")
  const cutIn = requireObject(mobile.cut_in, "mobile.battle_mobile.cut_in")
  const cutInText = requireObject(cutIn.text, "mobile.battle_mobile.cut_in.text")

  requireNumberInRange(userHand.card_gap_ratio, "mobile.user_hand.card_gap_ratio", { minimum: 0 })
  requireNumberInRange(userHand.vertical_edge_margin_ratio, "mobile.user_hand.vertical_edge_margin_ratio", { minimum: 0 })
  requireNumberInRange(userHand.edge_margin_ratio, "mobile.user_hand.edge_margin_ratio", { minimum: 0 })
  requirePositiveNumber(hp.bar_width_ratio, "mobile.hp.bar_width_ratio")
  requirePositiveNumber(hp.user_text_font_size_rem, "mobile.hp.user_text_font_size_rem")
  requireNumberInRange(level.offset_x_ratio, "mobile.level.offset_x_ratio", { minimum: 0 })
  requireNumberInRange(level.offset_y_ratio, "mobile.level.offset_y_ratio", { minimum: 0 })
  requirePositiveNumber(level.user_font_size_rem, "mobile.level.user_font_size_rem")
  requireNumberInRange(battleArea.center_offset_y_ratio, "mobile.battle_area.center_offset_y_ratio", { minimum: 0, maximumExclusive: 0.5 })
  requirePositiveNumber(cutIn.rectangle_height_rem, "mobile.cut_in.rectangle_height_rem")
  requirePositiveNumber(cutInText.font_size_rem, "mobile.cut_in.text.font_size_rem")
  return root
}

function battleStatusConfig(config) {
  return validateBattleStatusConfig(requireObject(config, "animations").battle_status)
}

function statusBackgroundRgb(team, config) {
  const statusConfig = battleStatusConfig(config)
  const color = statusConfig[`${team}_background_color`]
  return `${color.r}, ${color.g}, ${color.b}`
}

function setStatusInteractionEnabled(statusElement, enabled) {
  requireElement(statusElement, "操作対象ステータス")
  statusElement.classList[enabled ? "add" : "remove"]("battle__status-item--selectable")
  statusElement.setAttribute("aria-disabled", String(!enabled))
}

function resetSelectedStatusImmediately(statusElement) {
  requireElement(statusElement, "選択状態ステータス")
  statusElement.style.transform = "translateX(0px)"
  statusElement.classList.remove("battle__status-item--selected")
}

export async function setBattleStatusSelected({
  statusElement,
  battleAreaElement,
  selected,
  config
}) {
  requireElement(statusElement, "選択状態ステータス")
  requireElement(battleAreaElement, "ユーザー戦闘エリア")
  if (typeof selected !== "boolean") {
    throw new TypeError("バトルDOM: status selectedはbooleanである必要があります")
  }

  const statusConfig = battleStatusConfig(config)
  const battleAreaBounds = battleAreaElement.getBoundingClientRect()
  if (battleAreaBounds.width <= 0) {
    throw new Error("バトルDOM: ユーザー戦闘エリアの横幅を取得できません")
  }
  const shiftX = selected ? -(battleAreaBounds.width * statusConfig.selected_shift_ratio) : 0
  const fromTransform = statusElement.style.transform || "translateX(0px)"
  const toTransform = `translateX(${shiftX}px)`

  if (statusConfig.selected_shift_duration_ms > 0 && typeof statusElement.animate === "function") {
    const animation = statusElement.animate(
      [{ transform: fromTransform }, { transform: toTransform }],
      {
        duration: statusConfig.selected_shift_duration_ms,
        easing: "ease-out",
        fill: "forwards"
      }
    )
    await animation.finished
    animation.cancel?.()
  }

  statusElement.style.transform = toTransform
  statusElement.classList[selected ? "add" : "remove"]("battle__status-item--selected")
  return shiftX
}

function requireFunction(value, label) {
  if (typeof value !== "function") {
    throw new TypeError(`バトルDOM: ${label}は関数である必要があります`)
  }

  return value
}

function createAbortError() {
  const error = new Error("バトル操作が中断されました")
  error.name = "AbortError"
  return error
}

export const BATTLE_PREPARATION_FAILURE_CLASSIFICATIONS = Object.freeze({
  MINOR: "minor",
  RETRYABLE: "retryable",
  FATAL: "fatal"
})

export class BattleViewPreparationError extends Error {
  constructor(message, { code, classification, elementLabel = null, cause = null } = {}) {
    super(message)
    this.name = "BattleViewPreparationError"
    this.code = code
    this.classification = classification
    this.elementLabel = elementLabel
    if (cause !== null) this.cause = cause
  }
}

export function classifyBattleViewPreparationError(error) {
  if (
    error instanceof BattleViewPreparationError &&
    error.classification === BATTLE_PREPARATION_FAILURE_CLASSIFICATIONS.RETRYABLE
  ) {
    return BATTLE_PREPARATION_FAILURE_CLASSIFICATIONS.RETRYABLE
  }

  // 重度な失敗（再読み込みでも治らなさそう）:
  // DOM欠損・API不在・配列不正など、明示的に再試行可能としたもの以外は安全のため即停止する。
  return BATTLE_PREPARATION_FAILURE_CLASSIFICATIONS.FATAL
}

function requireTeamAndSlot(team, slot) {
  const validSlots = team === "user" ? USER_SLOTS : team === "enemy" ? ENEMY_SLOTS : null

  if (validSlots === null || !validSlots.includes(slot)) {
    throw new RangeError(`バトルDOM: 不正なチームまたはスロットです: ${team}/${slot}`)
  }
}

function validateOrderedSlots(elements, expectedSlots, label) {
  const actualSlots = elements.map((element) => element.dataset.slot)

  if (
    actualSlots.length !== expectedSlots.length ||
    actualSlots.some((slot, index) => slot !== expectedSlots[index])
  ) {
    throw new Error(
      `バトルDOM: ${label}のスロット順が不正です。期待値: ${expectedSlots.join(",")}、実際: ${actualSlots.join(",")}`
    )
  }

  if (new Set(actualSlots).size !== expectedSlots.length) {
    throw new Error(`バトルDOM: ${label}に重複スロットがあります`)
  }
}

function validateCardStateAttributes(elements, label) {
  const requiredDatasetKeys = ["cardId", "isRental", "selected", "deployed", "canBattle"]
  const motionSelectors = [
    "[data-battle-animation-position]",
    "[data-battle-animation-size]",
    "[data-battle-animation-orientation]",
    "[data-battle-animation-flip]",
    "[data-battle-animation-selection]",
    "[data-battle-animation-attack]"
  ]

  for (const element of elements) {
    for (const key of requiredDatasetKeys) {
      if (!(key in element.dataset)) {
        throw new Error(`バトルDOM: ${label}/${element.dataset.slot}にdata-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}がありません`)
      }
    }

    if (!element.hasAttribute("aria-disabled")) {
      throw new Error(`バトルDOM: ${label}/${element.dataset.slot}にaria-disabledがありません`)
    }
    const motionElements = motionSelectors.map((selector) => requireElement(
      element.querySelector(selector),
      `${label}/${element.dataset.slot}の${selector}`
    ))
    if (new Set(motionElements).size !== motionElements.length) {
      throw new Error(`バトルDOM: ${label}/${element.dataset.slot}のtransform担当要素が分離されていません`)
    }
    requireElement(element.querySelector("[data-battle-animation-shadow]"), `${label}/${element.dataset.slot}の攻撃用影`)
    requireElement(element.querySelector("[data-battle-animation-motion]"), `${label}/${element.dataset.slot}のモーション要素`)
    requireElement(element.querySelector("[data-battle-effect-layer]"), `${label}/${element.dataset.slot}のエフェクトレイヤー`)
    requireElement(element.querySelector("[data-battle-mobile-hud]"), `${label}/${element.dataset.slot}のモバイルHUD`)
  }
}

function findSyukamonData(cardId, syukamonData) {
  requireObject(syukamonData, "syukamonData")
  const cardData = Object.values(syukamonData).find((data) => data?.id === cardId)

  if (cardData === undefined) {
    throw new Error(`バトルDOM: カードID ${cardId} の画像情報がありません`)
  }

  return cardData
}

function visualDataFor(card, syukamonData, assets) {
  const cardData = findSyukamonData(card.id, syukamonData)
  const assetData = requireObject(assets, "assets")
  const cardImageUrls = requireObject(assetData.cardImageUrls, "assets.cardImageUrls")
  const rentalCardImageUrls = requireObject(assetData.rentalCardImageUrls, "assets.rentalCardImageUrls")
  const portraitImageUrls = requireObject(assetData.portraitImageUrls, "assets.portraitImageUrls")
  const cardImageUrl = card.isRental === true
    ? rentalCardImageUrls[String(card.id)]
    : cardImageUrls[String(card.id)]
  const portraitImageUrl = portraitImageUrls[String(card.id)]

  if (typeof cardData.short_name !== "string" || cardData.short_name.trim().length === 0) {
    throw new Error(`バトルDOM: カードID ${card.id} のshort_nameがありません`)
  }
  if (typeof cardImageUrl !== "string" || cardImageUrl.length === 0) {
    throw new Error(`バトルDOM: カードID ${card.id} のカード画像URLがありません`)
  }
  if (typeof portraitImageUrl !== "string" || portraitImageUrl.length === 0) {
    throw new Error(`バトルDOM: カードID ${card.id} のポートレートURLがありません`)
  }

  return { name: cardData.short_name.trim(), cardImageUrl, portraitImageUrl }
}

export function getCardElement(root, team, slot) {
  requireTeamAndSlot(team, slot)
  return requireElement(
    root.querySelector(`.battle__hand-card[data-team="${team}"][data-slot="${slot}"]`),
    `${team}/${slot}の手札カード`
  )
}

export function getStatusElements(root, team, slot) {
  requireTeamAndSlot(team, slot)
  const statusElement = requireElement(
    root.querySelector(`.battle__status-item[data-team="${team}"][data-slot="${slot}"]`),
    `${team}/${slot}のステータス`
  )

  return {
    statusElement,
    portraitElement: requireElement(statusElement.querySelector('[data-role="portrait"]'), "ポートレート"),
    nameElement: requireElement(statusElement.querySelector('[data-role="card-name"]'), "カード名"),
    levelElement: requireElement(statusElement.querySelector('[data-role="level"]'), "レベル"),
    hpBarElement: requireElement(statusElement.querySelector('[data-role="hp-bar"]'), "HPバー"),
    hpFillElement: requireElement(statusElement.querySelector('[data-role="hp-fill"]'), "HP現在値バー"),
    currentHpElement: requireElement(statusElement.querySelector('[data-role="current-hp"]'), "現在HP"),
    maxHpElement: requireElement(statusElement.querySelector('[data-role="max-hp"]'), "最大HP"),
    statusValuesElement: requireElement(statusElement.querySelector('[data-role="status-values"]'), "ステータス数値")
  }
}

export function getMobileHudElements(root, team, slot) {
  requireTeamAndSlot(team, slot)
  const cardElement = getCardElement(root, team, slot)
  const hudElement = requireElement(
    cardElement.querySelector('[data-battle-mobile-hud]'),
    `${team}/${slot}のモバイルHUD`
  )

  return {
    hudElement,
    levelElement: requireElement(hudElement.querySelector('[data-role="mobile-level"]'), "モバイルレベル"),
    hpBarElement: requireElement(hudElement.querySelector('[data-role="mobile-hp-bar"]'), "モバイルHPバー"),
    hpFillElement: requireElement(hudElement.querySelector('[data-role="mobile-hp-fill"]'), "モバイルHP現在値バー"),
    currentHpElement: requireElement(hudElement.querySelector('[data-role="mobile-current-hp"]'), "モバイル現在HP")
  }
}

export function getBattleUiElements(root) {
  return {
    battleElement: requireElement(root.querySelector(".battle"), "バトル画面"),
    userCardElements: USER_SLOTS.map((slot) => getCardElement(root, "user", slot)),
    enemyCardElements: ENEMY_SLOTS.map((slot) => getCardElement(root, "enemy", slot)),
    userStatusListElement: requireElement(root.querySelector(".battle__status-list--right"), "ユーザーステータス一覧"),
    enemyStatusListElement: requireElement(root.querySelector(".battle__status-list--left"), "エネミーステータス一覧"),
    userBattleAreaElement: requireElement(root.querySelector('.battle__center-panel[data-team="user"]'), "ユーザー戦闘エリア"),
    enemyBattleAreaElement: requireElement(root.querySelector('.battle__center-panel[data-team="enemy"]'), "エネミー戦闘エリア"),
    userBattleStatusAnchorElement: requireElement(root.querySelector('[data-battle-status-anchor][data-team="user"]'), "ユーザー戦闘ステータス位置"),
    enemyBattleStatusAnchorElement: requireElement(root.querySelector('[data-battle-status-anchor][data-team="enemy"]'), "エネミー戦闘ステータス位置"),
    userDefeatEffectLayerElement: requireElement(root.querySelector('[data-battle-defeat-effect-layer][data-team="user"]'), "ユーザー撃破エフェクトレイヤー"),
    enemyDefeatEffectLayerElement: requireElement(root.querySelector('[data-battle-defeat-effect-layer][data-team="enemy"]'), "エネミー撃破エフェクトレイヤー"),
    choiceDimElement: requireElement(root.querySelector("[data-battle-animation-choice-dim]"), "選択時の暗転領域"),
    choicePromptElement: requireElement(root.querySelector("[data-battle-animation-choice-prompt]"), "カード選択案内"),
    battleStartElement: requireElement(root.querySelector("[data-battle-animation-start-message]"), "バトル開始表示"),
    entryCoverElement: requireElement(root.querySelector("[data-battle-entry-cover]"), "バトル開始遮蔽")
  }
}

export function beginBattleEntryCoverFade({ coverElement, durationMs }) {
  const cover = requireElement(coverElement, "バトル開始遮蔽")
  if (!Number.isInteger(durationMs) || durationMs < 0) {
    throw new RangeError("バトルDOM: 開始遮蔽時間は0以上の整数である必要があります")
  }

  cover.hidden = false
  cover.style.pointerEvents = "auto"
  cover.style.transition = `opacity ${durationMs}ms linear`
  // CSSで確定済みの初期opacityを先に描画し、同一フレームでの瞬時切替を防ぐ。
  void cover.offsetWidth
  cover.style.opacity = "0"
}

export function finishBattleEntryCover({ coverElement }) {
  const cover = requireElement(coverElement, "バトル開始遮蔽")
  cover.style.opacity = "0"
  cover.style.pointerEvents = "none"
  cover.hidden = true
}

async function waitForBattleImageLoad(imageElement) {
  // 重度な失敗（再読み込みでも治らなさそう）:
  // 画像イベントAPI自体がない場合は軽微な通信失敗ではなくDOM契約違反として停止する。
  requireFunction(imageElement.addEventListener, "事前準備対象画像のaddEventListener")
  requireFunction(imageElement.removeEventListener, "事前準備対象画像のremoveEventListener")

  if (imageElement.complete === true) {
    return typeof imageElement.naturalWidth !== "number" || imageElement.naturalWidth > 0
  }

  return new Promise((resolve, reject) => {
    const finish = (loaded) => {
      try {
        imageElement.removeEventListener?.("load", onLoad)
        imageElement.removeEventListener?.("error", onError)
        resolve(loaded)
      } catch (error) {
        reject(error)
      }
    }
    const onLoad = () => finish(true)
    const onError = () => finish(false)

    imageElement.addEventListener?.("load", onLoad, { once: true })
    imageElement.addEventListener?.("error", onError, { once: true })
  })
}

function reloadBattleImage(imageElement) {
  const source = imageElement.currentSrc || imageElement.src
  if (typeof source !== "string" || source.length === 0) return

  imageElement.removeAttribute?.("src")
  imageElement.src = source
}

async function waitForBattleImage(imageElement, logger) {
  requireElement(imageElement, "事前準備対象画像")

  if (typeof imageElement.decode === "function") {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await imageElement.decode()
        return
      } catch (error) {
        if (attempt === 1) continue

        // 軽微な失敗:
        // decodeは失敗対象だけ1回再試行し、2回目も失敗した場合は代替表示へ委ねて戦闘を続行する。
        logger.warn?.("バトル事前準備: 画像decodeに2回失敗したため代替表示で続行します", {
          classification: BATTLE_PREPARATION_FAILURE_CLASSIFICATIONS.MINOR,
          attempts: attempt
        }, error)
      }
    }
    return
  }

  const loaded = await waitForBattleImageLoad(imageElement)
  if (loaded) return

  reloadBattleImage(imageElement)
  const loadedAfterRetry = await waitForBattleImageLoad(imageElement)
  if (!loadedAfterRetry) {
    // 軽微な失敗:
    // decode非対応環境の画像errorも失敗対象だけ1回再読込し、再失敗後は代替表示で続行する。
    logger.warn?.("バトル事前準備: 画像読込に2回失敗したため代替表示で続行します", {
      classification: BATTLE_PREPARATION_FAILURE_CLASSIFICATIONS.MINOR,
      attempts: 2
    })
  }
}

function nextAnimationFrame(requestFrame) {
  return new Promise((resolve) => requestFrame(() => resolve()))
}

function requireDisplayedBounds(element, label) {
  requireElement(element, label)
  if (typeof element.getBoundingClientRect !== "function") {
    throw new TypeError(`バトルDOM: ${label}の表示サイズを取得できません`)
  }
  const bounds = element.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0) {
    // 重度な失敗（一時的な表示サイズ未確定・1回だけ再試行）:
    // DOM契約は存在するため、レイアウト確定の遅延だけを想定してprepare全体を1回再実行する。
    throw new BattleViewPreparationError(
      `バトルDOM: ${label}の表示サイズが確定していません`,
      {
        code: "display-bounds-not-ready",
        classification: BATTLE_PREPARATION_FAILURE_CLASSIFICATIONS.RETRYABLE,
        elementLabel: label
      }
    )
  }
  return bounds
}

// 実DOM・画像・レイアウト・初期transformをcover内で確定し、モーション開始とは分離する。
export async function prepareBattleView({
  battleUi,
  documentRef = document,
  requestFrame = null,
  logger = console
}) {
  // --- バトル事前準備処理ここから ---
  const ui = requireObject(battleUi, "battleUi")
  const battleElement = requireElement(ui.battleElement, "バトル画面")

  const view = documentRef?.defaultView || globalThis
  const resolvedRequestFrame = requestFrame || view.requestAnimationFrame?.bind(view)
  requireFunction(resolvedRequestFrame, "requestAnimationFrame")

  // 重度な失敗（再読み込みでも治らなさそう）:
  // 必須DOM APIやカード配列などの契約違反は、この関数からそのままrejectして即停止させる。
  requireFunction(battleElement.querySelectorAll, "バトル画面のquerySelectorAll")
  const images = [...battleElement.querySelectorAll("img")]
    .filter((image) => image.hidden !== true && typeof image.src === "string" && image.src.length > 0)
  const fontsReady = documentRef?.fonts?.ready
  await Promise.all([
    ...images.map((image) => waitForBattleImage(image, logger)),
    fontsReady && typeof fontsReady.then === "function"
      // 軽微な失敗:
      // FontFaceSet.readyは同じ失敗済みPromiseを再度待っても意味がないため、既存どおり握りつぶす。
      ? Promise.resolve(fontsReady).catch(() => undefined)
      : Promise.resolve()
  ])

  // 1フレーム目でDOM更新とCSSをレイアウトへ反映する。
  await nextAnimationFrame(resolvedRequestFrame)

  const cardElements = [...ui.userCardElements, ...ui.enemyCardElements]
  requireDisplayedBounds(battleElement, "バトル画面")
  cardElements.forEach((cardElement, index) => {
    requireDisplayedBounds(cardElement, `カード${index + 1}`)
    const positionElement = requireElement(
      cardElement.querySelector?.("[data-battle-animation-position]"),
      `カード${index + 1}の位置要素`
    )
    requireDisplayedBounds(positionElement, `カード${index + 1}の位置要素`)
  })
  // portraitではPC用statusをSCSSだけで非表示にするため、CSS上display:noneの一覧はサイズ必須条件から除く。
  for (const [statusList, label] of [
    [ui.userStatusListElement, "ユーザーステータス一覧"],
    [ui.enemyStatusListElement, "エネミーステータス一覧"]
  ]) {
    const computedStyle = typeof view.getComputedStyle === "function"
      ? view.getComputedStyle(statusList)
      : null
    if (computedStyle?.display !== "none") requireDisplayedBounds(statusList, label)
  }
  requireDisplayedBounds(ui.userBattleAreaElement, "ユーザー戦闘エリア")
  requireDisplayedBounds(ui.enemyBattleAreaElement, "エネミー戦闘エリア")

  // 2フレーム目まで待ち、上で確定した開始位置を一度paintしてから呼び出し元へ返す。
  await nextAnimationFrame(resolvedRequestFrame)
  // --- バトル事前準備処理ここまで ---
  return { imageCount: images.length }
}

export function getBattlePageUiElements(root) {
  const resultScreenElement = requireElement(root.querySelector("[data-battle-result-screen]"), "リザルト画面")
  const preparationErrorScreenElement = requireElement(
    root.querySelector("[data-battle-preparation-error-screen]"),
    "バトル事前準備エラー画面"
  )

  return {
    preparationErrorScreenElement,
    preparationErrorReturnElement: requireElement(
      preparationErrorScreenElement.querySelector("[data-battle-preparation-error-return]"),
      "習慣画面へ戻るリンク"
    ),
    resultScreenElement,
    resultCardAreaElement: requireElement(resultScreenElement.querySelector("[data-battle-result-card-area]"), "リザルトカード領域"),
    resultCardElement: requireElement(resultScreenElement.querySelector("[data-battle-result-card]"), "リザルトカード"),
    resultHeadingElement: requireElement(resultScreenElement.querySelector("[data-battle-result-heading]"), "勝敗表示"),
    resultRateBeforeElement: requireElement(resultScreenElement.querySelector("[data-battle-result-rate-before]"), "変更前レート"),
    resultRateAfterElement: requireElement(resultScreenElement.querySelector("[data-battle-result-rate-after]"), "変更後レート"),
    resultDialogueElement: requireElement(resultScreenElement.querySelector("[data-battle-result-dialogue]"), "リザルトセリフ領域"),
    resultNameElement: requireElement(resultScreenElement.querySelector("[data-battle-result-name]"), "リザルトカード名"),
    resultMessageElement: requireElement(resultScreenElement.querySelector("[data-battle-result-message]"), "リザルトセリフ"),
    resultErrorElement: requireElement(resultScreenElement.querySelector("[data-battle-result-error]"), "保存失敗表示"),
    resultActionElements: [...resultScreenElement.querySelectorAll("[data-battle-result-action]")]
  }
}

export function showBattlePreparationError({ pageUi, battleUi }) {
  const page = requireObject(pageUi, "pageUi")
  const battle = requireObject(battleUi, "battleUi")
  const errorScreen = requireElement(page.preparationErrorScreenElement, "バトル事前準備エラー画面")
  const returnElement = requireElement(page.preparationErrorReturnElement, "習慣画面へ戻るリンク")
  const battleElement = requireElement(battle.battleElement, "バトル画面")

  setBattleScreenAvailability({ battleElement, available: false })
  finishBattleEntryCover({ coverElement: battle.entryCoverElement })
  battleElement.hidden = true
  errorScreen.hidden = false
  errorScreen.inert = false
  errorScreen.setAttribute("aria-hidden", "false")
  returnElement.focus?.()
  return errorScreen
}

export function setBattleScreenAvailability({ battleElement, available }) {
  requireElement(battleElement, "バトル画面")
  if (typeof available !== "boolean") {
    throw new TypeError("バトルDOM: availableはbooleanである必要があります")
  }

  battleElement.inert = !available
  battleElement.setAttribute("aria-hidden", String(!available))
}

export function setupBattleSurrenderDialog({
  root,
  battleElement,
  onConfirm
}) {
  requireElement(root, "降参ダイアログのdocument")
  requireElement(battleElement, "バトル画面")
  requireFunction(onConfirm, "onConfirm")

  const openButton = requireElement(root.querySelector("[data-battle-surrender-open]"), "降参ボタン")
  const layer = requireElement(root.querySelector("[data-battle-surrender-layer]"), "降参確認レイヤー")
  const cancelButton = requireElement(layer.querySelector("[data-battle-surrender-cancel]"), "あきらめないボタン")
  const confirmButton = requireElement(layer.querySelector("[data-battle-surrender-confirm]"), "降参確定ボタン")
  let visible = false
  let enabled = false
  let dialogOpen = false
  let confirmed = false
  let destroyed = false
  const userStatusList = root.querySelector(".battle__status-list--right")
  const userBattleArea = root.querySelector('.battle__center-panel[data-team="user"]')
  const view = root.defaultView ?? globalThis.window

  const positionOpenButton = () => {
    if (typeof userBattleArea?.getBoundingClientRect === "function") {
      const battleAreaBounds = userBattleArea.getBoundingClientRect()
      const battleAreaCenterY = battleAreaBounds.top + (battleAreaBounds.height / 2)
      if (Number.isFinite(battleAreaCenterY)) {
        openButton.style.setProperty?.("--battle-surrender-mobile-center-y", `${battleAreaCenterY}px`)
      }
    }
    if (typeof userStatusList?.getBoundingClientRect !== "function") return
    const viewportHeight = view?.innerHeight ?? root.documentElement?.clientHeight
    if (typeof viewportHeight !== "number" || !Number.isFinite(viewportHeight) || viewportHeight <= 0) return

    const statusBottom = Math.max(0, Math.min(userStatusList.getBoundingClientRect().bottom, viewportHeight))
    // ステータス下端から画面下端までの余白で、下側1/3の中央は全体の5/6地点になる。
    const lowerGapCenter = statusBottom + ((viewportHeight - statusBottom) * (5 / 6))
    const buttonHalfHeight = openButton.getBoundingClientRect().height / 2
    const viewportSafeCenter = Math.min(lowerGapCenter, viewportHeight - buttonHalfHeight)
    openButton.style.top = `${viewportSafeCenter}px`
  }

  const syncOpenButton = () => {
    openButton.hidden = !visible
    openButton.disabled = !visible || !enabled || dialogOpen || confirmed
  }

  const closeDialog = ({ restoreFocus = true } = {}) => {
    if (!dialogOpen || confirmed) return
    dialogOpen = false
    layer.hidden = true
    layer.setAttribute("aria-hidden", "true")
    battleElement.inert = false
    syncOpenButton()
    if (restoreFocus) openButton.focus?.()
  }

  const openDialog = () => {
    if (destroyed || !visible || !enabled || dialogOpen || confirmed) return
    dialogOpen = true
    battleElement.inert = true
    layer.hidden = false
    layer.setAttribute("aria-hidden", "false")
    syncOpenButton()
    cancelButton.focus?.()
  }

  const handleLayerClick = (event) => {
    if (event.target === layer) closeDialog()
  }
  const handleKeydown = (event) => {
    if (event.key === "Escape" && dialogOpen && !confirmed) {
      event.preventDefault?.()
      closeDialog()
    }
  }
  const handleConfirm = () => {
    if (!dialogOpen || confirmed) return
    confirmed = true
    enabled = false
    openButton.disabled = true
    cancelButton.disabled = true
    confirmButton.disabled = true
    onConfirm()
  }

  openButton.addEventListener("click", openDialog)
  cancelButton.addEventListener("click", closeDialog)
  confirmButton.addEventListener("click", handleConfirm)
  layer.addEventListener("click", handleLayerClick)
  root.addEventListener("keydown", handleKeydown)
  view?.addEventListener?.("resize", positionOpenButton)
  positionOpenButton()
  syncOpenButton()

  return {
    setVisible(nextVisible) {
      visible = nextVisible === true
      if (!visible && dialogOpen && !confirmed) closeDialog({ restoreFocus: false })
      syncOpenButton()
      if (visible) positionOpenButton()
    },
    setEnabled(nextEnabled) {
      enabled = nextEnabled === true
      syncOpenButton()
    },
    finish() {
      visible = false
      enabled = false
      openButton.hidden = true
      openButton.disabled = true
      if (!confirmed) battleElement.inert = false
      layer.hidden = true
      layer.setAttribute("aria-hidden", "true")
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      openButton.removeEventListener("click", openDialog)
      cancelButton.removeEventListener("click", closeDialog)
      confirmButton.removeEventListener("click", handleConfirm)
      layer.removeEventListener("click", handleLayerClick)
      root.removeEventListener("keydown", handleKeydown)
      view?.removeEventListener?.("resize", positionOpenButton)
    }
  }
}

export function renderBattleResult({
  ui,
  outcome,
  rateBefore,
  rateAfter,
  cardView = null,
  cardWidth
}) {
  requireObject(ui, "resultUi")
  if (outcome !== "win" && outcome !== "lose") {
    throw new RangeError("バトルDOM: outcomeはwinまたはloseである必要があります")
  }
  if (!Number.isInteger(rateBefore) || rateBefore < 0 || !Number.isInteger(rateAfter) || rateAfter < 0) {
    throw new RangeError("バトルDOM: リザルトレートは0以上の整数である必要があります")
  }
  requireFiniteNumber(cardWidth, "リザルトカード横幅")
  if (cardWidth <= 0) throw new RangeError("バトルDOM: リザルトカード横幅は0より大きい必要があります")

  ui.resultHeadingElement.textContent = outcome === "win" ? "Win!" : "Lose..."
  ui.resultHeadingElement.classList.remove("battle-result-screen__heading--win", "battle-result-screen__heading--lose")
  ui.resultHeadingElement.classList.add(`battle-result-screen__heading--${outcome}`)
  ui.resultRateBeforeElement.textContent = String(rateBefore)
  ui.resultRateAfterElement.textContent = String(rateAfter)
  ui.resultErrorElement.hidden = true

  if (cardView === null) {
    ui.resultCardElement.hidden = true
    ui.resultCardElement.src = ""
    ui.resultCardElement.alt = ""
    ui.resultDialogueElement.hidden = true
    ui.resultNameElement.textContent = ""
    ui.resultMessageElement.textContent = ""
  } else {
    const view = requireObject(cardView, "cardView")
    if (![view.name, view.cardImageUrl, view.message].every((value) => typeof value === "string" && value.length > 0)) {
      throw new Error("バトルDOM: リザルトカード表示情報が不足しています")
    }
    ui.resultCardElement.src = view.cardImageUrl
    ui.resultCardElement.alt = `${view.name}のカード`
    ui.resultCardElement.style.width = `${cardWidth}px`
    ui.resultCardElement.hidden = false
    ui.resultNameElement.textContent = view.name
    ui.resultMessageElement.textContent = view.message
    ui.resultDialogueElement.hidden = false
  }

  ui.resultScreenElement.hidden = false
  ui.resultScreenElement.inert = false
  ui.resultScreenElement.setAttribute("aria-hidden", "false")
  return ui.resultScreenElement
}

export function setResultSavingState(ui, saving) {
  requireObject(ui, "resultUi")
  if (typeof saving !== "boolean") {
    throw new TypeError("バトルDOM: savingはbooleanである必要があります")
  }
  if (!Array.isArray(ui.resultActionElements) || ui.resultActionElements.length !== 2) {
    throw new Error("バトルDOM: リザルト操作ボタンは2個必要です")
  }

  for (const button of ui.resultActionElements) button.disabled = saving
  ui.resultScreenElement.setAttribute("aria-busy", String(saving))
  return saving
}

export function syncDefeatEffectLayer({ battleElement, battleAreaElement, effectLayerElement }) {
  requireElement(battleElement, "バトル画面")
  requireElement(battleAreaElement, "戦闘エリア")
  requireElement(effectLayerElement, "撃破エフェクトレイヤー")
  const battleBounds = battleElement.getBoundingClientRect()
  const areaBounds = battleAreaElement.getBoundingClientRect()

  if (areaBounds.width <= 0 || areaBounds.height <= 0) {
    throw new Error("バトルDOM: 戦闘エリアの表示サイズを取得できません")
  }

  effectLayerElement.style.left = `${areaBounds.left - battleBounds.left}px`
  effectLayerElement.style.top = `${areaBounds.top - battleBounds.top}px`
  effectLayerElement.style.width = `${areaBounds.width}px`
  effectLayerElement.style.height = `${areaBounds.height}px`
  return effectLayerElement
}

export function setCardSelectionState(cardElement, { selected, deployed = null }) {
  requireElement(cardElement, "選択状態カード")
  if (typeof selected !== "boolean") {
    throw new TypeError("バトルDOM: selectedはbooleanである必要があります")
  }
  if (deployed !== null && typeof deployed !== "boolean") {
    throw new TypeError("バトルDOM: deployedはbooleanまたはnullである必要があります")
  }

  cardElement.dataset.selected = String(selected)
  if (deployed !== null) cardElement.dataset.deployed = String(deployed)
  return cardElement
}

export function setCardInteractionEnabled(cardElement, enabled) {
  requireElement(cardElement, "操作対象カード")
  if (typeof enabled !== "boolean") {
    throw new TypeError("バトルDOM: enabledはbooleanである必要があります")
  }

  const isEnabled = enabled &&
    cardElement.dataset.canBattle === "true" &&
    cardElement.dataset.deployed !== "true"
  cardElement.setAttribute("aria-disabled", String(!isEnabled))
  return isEnabled
}

export function setCardBattleState({ root, team, slot, canBattle }) {
  if (typeof canBattle !== "boolean") {
    throw new TypeError("バトルDOM: canBattleはbooleanである必要があります")
  }

  const cardElement = getCardElement(root, team, slot)
  const statusElement = getStatusElements(root, team, slot).statusElement
  cardElement.dataset.canBattle = String(canBattle)
  cardElement.setAttribute("aria-disabled", String(!canBattle))
  statusElement.style.visibility = canBattle ? "visible" : "hidden"
  setMobileCardHudVisible({ root, team, slot, visible: canBattle })
  if (!canBattle) {
    setCardSelectionState(cardElement, { selected: false })
    discardStatusHandPlaceholder(statusElement)
  }
  return cardElement
}

export function setMobileCardHudVisible({ root, team, slot, visible }) {
  if (typeof visible !== "boolean") {
    throw new TypeError("バトルDOM: mobile HUD visibleはbooleanである必要があります")
  }
  const { hudElement } = getMobileHudElements(root, team, slot)
  hudElement.classList[visible ? "remove" : "add"]("is-battle-hidden")
  hudElement.setAttribute("aria-hidden", String(!visible))
  return hudElement
}

export async function animateMobileCardHudHp({ root, team, slot, hpBefore, hpAfter, maxHp, config }) {
  const mobile = getMobileHudElements(root, team, slot)
  await Promise.all([
    animateNumberChange({
      numberElement: mobile.currentHpElement,
      fromValue: hpBefore,
      toValue: hpAfter,
      config
    }),
    animateHpBar({
      hpFillElement: mobile.hpFillElement,
      hpBefore,
      hpAfter,
      maxHp,
      config: requireObject(config, "animations").number_change
    })
  ])
  mobile.hpBarElement.setAttribute("aria-label", `現在HP ${hpAfter} / ${maxHp}`)
  return mobile
}

export async function animateHpBar({ hpFillElement, hpBefore, hpAfter, maxHp, config }) {
  requireElement(hpFillElement, "HP現在値バー")
  requireFiniteNumber(hpBefore, "hpBefore")
  requireFiniteNumber(hpAfter, "hpAfter")
  requireFiniteNumber(maxHp, "maxHp")
  if (maxHp <= 0) throw new RangeError("バトルDOM: maxHpは0より大きい必要があります")

  const numberChangeConfig = requireObject(config, "number_change")
  const duration = calculateNumberChangeDuration({
    fromValue: Math.max(0, hpBefore),
    toValue: Math.max(0, hpAfter),
    numberChangeConfig
  })
  const beforePercent = Math.min(Math.max(hpBefore / maxHp, 0), 1) * 100
  const afterPercent = Math.min(Math.max(hpAfter / maxHp, 0), 1) * 100

  if (duration > 0 && typeof hpFillElement.animate === "function") {
    const animation = hpFillElement.animate(
      [{ width: `${beforePercent}%` }, { width: `${afterPercent}%` }],
      { duration, easing: "linear", fill: "forwards" }
    )
    await animation.finished
    hpFillElement.style.width = `${afterPercent}%`
    animation.cancel?.()
  } else {
    hpFillElement.style.width = `${afterPercent}%`
  }

  return duration
}

export function waitForUserCardSelection({
  root,
  userCards,
  battleAreaElement,
  config,
  signal = null,
  selectMotion = selectCard,
  deselectMotion = deselectCard,
  selectStatusMotion = ({ statusElement }) => setBattleStatusSelected({
    statusElement,
    battleAreaElement,
    selected: true,
    config
  }),
  deselectStatusMotion = ({ statusElement }) => setBattleStatusSelected({
    statusElement,
    battleAreaElement,
    selected: false,
    config
  }),
  onBusyChange = () => {}
}) {
  requireObject(userCards, "userCards")
  requireElement(battleAreaElement, "ユーザー戦闘エリア")
  if (
    typeof selectMotion !== "function" ||
    typeof deselectMotion !== "function" ||
    typeof selectStatusMotion !== "function" ||
    typeof deselectStatusMotion !== "function"
  ) {
    throw new TypeError("バトルDOM: カードとステータスの選択モーション関数が必要です")
  }
  requireFunction(onBusyChange, "onBusyChange")
  if (signal?.aborted) return Promise.reject(createAbortError())

  const entries = USER_SLOTS.map((slot) => {
    const card = requireObject(userCards[slot], `userCards.${slot}`)
    const cardElement = getCardElement(root, "user", slot)
    const statusElement = getStatusElements(root, "user", slot).statusElement
    if (cardElement.dataset.cardId !== String(card.id)) {
      throw new Error(`バトルDOM: user/${slot}のカードIDが状態と一致しません`)
    }
    if (statusElement.dataset.cardId !== String(card.id)) {
      throw new Error(`バトルDOM: user/${slot}のステータスカードIDが状態と一致しません`)
    }
    if (cardElement.dataset.canBattle !== String(card.canBattle === true)) {
      throw new Error(`バトルDOM: user/${slot}の戦闘可否が状態と一致しません`)
    }
    setCardSelectionState(cardElement, { selected: false, deployed: false })
    setCardInteractionEnabled(cardElement, card.canBattle === true)
    resetSelectedStatusImmediately(statusElement)
    setStatusInteractionEnabled(statusElement, card.canBattle === true)
    return { slot, card, cardElement, statusElement }
  })

  return new Promise((resolve, reject) => {
    let settled = false
    let selectedEntry = null
    let transition = Promise.resolve()
    const listeners = []

    const cleanup = () => {
      for (const { element, listener } of listeners) {
        element.removeEventListener("click", listener)
      }
      for (const entry of entries) setStatusInteractionEnabled(entry.statusElement, false)
      signal?.removeEventListener("abort", onAbort)
    }

    const resetAfterFailure = () => {
      for (const entry of entries) {
        setCardSelectionState(entry.cardElement, { selected: false, deployed: false })
        setCardInteractionEnabled(entry.cardElement, entry.card.canBattle === true)
        resetSelectedStatusImmediately(entry.statusElement)
      }
    }

    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      resetAfterFailure()
      reject(error)
    }

    const onAbort = () => fail(createAbortError())

    const handleSelection = async (entry) => {
      if (settled) return
      if (signal?.aborted) throw createAbortError()
      if (typeof root.contains === "function" && !root.contains(entry.cardElement)) {
        throw new Error(`バトルDOM: 選択中のuser/${entry.slot}カードが消失しました`)
      }
      if (
        entry.card.canBattle !== true ||
        entry.cardElement.dataset.canBattle !== "true" ||
        entry.cardElement.getAttribute("aria-disabled") !== "false" ||
        entry.cardElement.dataset.deployed === "true"
      ) return

      if (selectedEntry?.slot === entry.slot) {
        setCardSelectionState(entry.cardElement, { selected: true, deployed: true })
        for (const item of entries) setCardInteractionEnabled(item.cardElement, false)
        cleanup()
        await deselectStatusMotion({ statusElement: entry.statusElement, entry })
        if (signal?.aborted) throw createAbortError()
        settled = true
        resolve(entry)
        return
      }

      if (selectedEntry !== null) {
        setCardSelectionState(selectedEntry.cardElement, { selected: false })
        await Promise.all([
          deselectMotion({
            cardElement: selectedEntry.cardElement,
            otherCardElements: entries.filter((item) => item !== selectedEntry).map((item) => item.cardElement),
            config
          }),
          deselectStatusMotion({ statusElement: selectedEntry.statusElement, entry: selectedEntry })
        ])
        if (settled || signal?.aborted) return
      }

      await Promise.all([
        selectMotion({
          cardElement: entry.cardElement,
          otherCardElements: entries.filter((item) => item !== entry).map((item) => item.cardElement),
          team: "user",
          config
        }),
        selectStatusMotion({ statusElement: entry.statusElement, entry })
      ])
      if (settled || signal?.aborted) return
      if (entry.card.canBattle !== true || entry.cardElement.dataset.canBattle !== "true") {
        throw new Error(`バトルDOM: 選択中のuser/${entry.slot}カードが戦闘不能になりました`)
      }

      for (const item of entries) setCardSelectionState(item.cardElement, { selected: item === entry })
      selectedEntry = entry
    }

    const enqueueSelection = (entry) => {
      const listener = () => {
        onBusyChange(true)
        transition = transition
          .then(() => handleSelection(entry))
          .then(() => {
            if (!settled && !signal?.aborted) onBusyChange(false)
          })
          .catch(fail)
      }
      return listener
    }

    for (const entry of entries) {
      const listener = enqueueSelection(entry)
      entry.cardElement.addEventListener("click", listener)
      entry.statusElement.addEventListener("click", listener)
      listeners.push(
        { element: entry.cardElement, listener },
        { element: entry.statusElement, listener }
      )
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export function validateBattleDom(root) {
  if (root === null || typeof root?.querySelectorAll !== "function") {
    throw new TypeError("バトルDOM: rootはDOM検索可能である必要があります")
  }

  const userCardElements = [
    ...root.querySelectorAll('.battle__hand--user .battle__hand-card[data-team="user"][data-slot]')
  ]
  const enemyCardElements = [
    ...root.querySelectorAll('.battle__hand--enemy .battle__hand-card[data-team="enemy"][data-slot]')
  ]

  validateOrderedSlots(
    userCardElements,
    USER_SLOTS,
    "ユーザー手札"
  )
  validateOrderedSlots(
    enemyCardElements,
    ENEMY_DOM_SLOTS,
    "エネミー手札"
  )
  validateCardStateAttributes(userCardElements, "ユーザー手札")
  validateCardStateAttributes(enemyCardElements, "エネミー手札")
  validateOrderedSlots(
    [...root.querySelectorAll('.battle__status-list--right .battle__status-item[data-team="user"][data-slot]')],
    USER_SLOTS,
    "ユーザーステータス"
  )
  validateOrderedSlots(
    [...root.querySelectorAll('.battle__status-list--left .battle__status-item[data-team="enemy"][data-slot]')],
    ENEMY_DOM_SLOTS,
    "エネミーステータス"
  )

  for (const team of ["enemy", "user"]) {
    const areas = root.querySelectorAll(`.battle__center-panel[data-team="${team}"]`)
    if (areas.length !== 1) {
      throw new Error(`バトルDOM: ${team}の戦闘エリアは1個必要です`)
    }
    const effectLayers = root.querySelectorAll(`[data-battle-defeat-effect-layer][data-team="${team}"]`)
    if (effectLayers.length !== 1) {
      throw new Error(`バトルDOM: ${team}の撃破エフェクトレイヤーは1個必要です`)
    }
  }

  return true
}

export function renderCardSlot({ root, team, slot, card, syukamonData, assets }) {
  const cardElement = getCardElement(root, team, slot)
  const imageElement = requireElement(cardElement.querySelector('[data-role="card-image"]'), "カード画像")
  const visual = visualDataFor(card, syukamonData, assets)

  cardElement.dataset.cardId = String(card.id)
  cardElement.dataset.isRental = String(card.isRental === true)
  cardElement.dataset.selected = "false"
  cardElement.dataset.deployed = "false"
  cardElement.dataset.canBattle = String(card.canBattle === true)
  cardElement.setAttribute("aria-disabled", String(card.canBattle !== true))
  imageElement.src = visual.cardImageUrl
  imageElement.alt = `${visual.name}のカード`
  imageElement.hidden = false

  return cardElement
}

export function renderStatusSlot({ root, team, slot, card, syukamonData, assets, animationConfig }) {
  const elements = getStatusElements(root, team, slot)
  const visual = visualDataFor(card, syukamonData, assets)
  let levelText = "レンタル"
  if (card.isRental !== true) {
    const level = requireFiniteNumber(card.level, `${team}/${slot}の確定済みレベル`)
    if (!Number.isInteger(level) || level <= 0) {
      throw new RangeError(`バトルDOM: ${team}/${slot}の確定済みレベルは1以上の整数である必要があります`)
    }
    levelText = `Lv. ${level}`
  }
  const hpRatio = card.initialHp > 0 ? Math.max(0, Math.min(card.currentHp / card.initialHp, 1)) : 0

  elements.statusElement.dataset.cardId = String(card.id)
  elements.statusElement.dataset.isRental = String(card.isRental === true)
  if (typeof elements.statusElement.style.setProperty === "function") {
    elements.statusElement.style.setProperty("--battle-status-rgb", statusBackgroundRgb(team, animationConfig))
  } else {
    elements.statusElement.style["--battle-status-rgb"] = statusBackgroundRgb(team, animationConfig)
  }
  elements.portraitElement.src = visual.portraitImageUrl
  elements.portraitElement.alt = `${visual.name}のポートレート`
  elements.portraitElement.hidden = false
  elements.nameElement.textContent = visual.name
  elements.levelElement.textContent = levelText
  elements.currentHpElement.textContent = String(card.currentHp)
  elements.maxHpElement.textContent = String(card.initialHp)
  elements.hpFillElement.style.width = `${hpRatio * 100}%`
  elements.hpBarElement.setAttribute("aria-label", `現在HP ${card.currentHp} / ${card.initialHp}`)
  elements.statusValuesElement.hidden = false

  return elements
}

export function renderMobileHudSlot({ root, team, slot, card, animationConfig }) {
  const elements = getMobileHudElements(root, team, slot)
  const level = card.isRental === true
    ? "レンタル"
    : (card.level === null ? "Lv. -" : `Lv. ${requireFiniteNumber(card.level, `${team}/${slot}の確定済みレベル`)}`)
  const hpRatio = card.initialHp > 0 ? Math.max(0, Math.min(card.currentHp / card.initialHp, 1)) : 0

  elements.hudElement.dataset.cardId = String(card.id)
  elements.hudElement.dataset.isRental = String(card.isRental === true)
  if (typeof elements.hudElement.style.setProperty === "function") {
    elements.hudElement.style.setProperty("--battle-mobile-hud-rgb", statusBackgroundRgb(team, animationConfig))
  } else {
    elements.hudElement.style["--battle-mobile-hud-rgb"] = statusBackgroundRgb(team, animationConfig)
  }
  elements.levelElement.textContent = level
  elements.currentHpElement.textContent = String(card.currentHp)
  elements.hpFillElement.style.width = `${hpRatio * 100}%`
  elements.hpBarElement.setAttribute("aria-label", `現在HP ${card.currentHp} / ${card.initialHp}`)
  setMobileCardHudVisible({ root, team, slot, visible: card.canBattle === true })
  return elements
}

export function renderBattleDecks({ root = document, context }) {
  validateBattleDom(root)
  const battleContext = requireObject(context, "context")
  const syukamonData = requireObject(battleContext.syukamonData, "context.syukamonData")
  const assets = requireObject(battleContext.assets, "context.assets")
  const animationConfig = requireObject(battleContext.config?.animations, "context.config.animations")
  const teams = [
    ["user", USER_SLOTS, battleContext.userCards],
    ["enemy", ENEMY_SLOTS, battleContext.enemyCards]
  ]

  for (const [team, slots, cards] of teams) {
    requireObject(cards, `context.${team}Cards`)

    for (const slot of slots) {
      const card = cards[slot]
      if (card === null || typeof card !== "object" || Array.isArray(card)) {
        throw new Error(`バトルDOM: ${team}/${slot}のカード状態がありません`)
      }

      renderCardSlot({ root, team, slot, card, syukamonData, assets })
      renderStatusSlot({ root, team, slot, card, syukamonData, assets, animationConfig })
      renderMobileHudSlot({ root, team, slot, card, animationConfig })
    }
  }

  return context
}

export { USER_SLOTS, ENEMY_SLOTS, ENEMY_DOM_SLOTS }
