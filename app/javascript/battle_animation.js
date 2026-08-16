const CONFIG_ELEMENT_ID = "battle-animations-config"
const CARD_BACK_URL_DATASET_KEY = "cardBackUrl"
const VALID_TEAMS = ["user", "enemy"]
const cardFrontImageUrls = new WeakMap()
const cardMovementStates = new WeakMap()
const statusMovementStates = new WeakMap()
const activeAnimations = new WeakMap()
const warnedMissingShadowCards = new WeakSet()

const requireObject = (value, path) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`バトルモーション設定: ${path}はオブジェクトである必要があります`)
  }

  return value
}

const requireNumber = (
  value,
  path,
  { minimum = null, maximum = null, integer = false } = {}
) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`バトルモーション設定: ${path}は数値である必要があります`)
  }

  if (minimum !== null && value < minimum) {
    throw new Error(`バトルモーション設定: ${path}は${minimum}以上である必要があります`)
  }

  if (maximum !== null && value > maximum) {
    throw new Error(`バトルモーション設定: ${path}は${maximum}以下である必要があります`)
  }

  if (integer && !Number.isInteger(value)) {
    throw new Error(`バトルモーション設定: ${path}は整数である必要があります`)
  }

  return value
}

const requireDuration = (value, path) => requireNumber(value, path, { minimum: 0 })
const requireRatio = (value, path) => requireNumber(value, path, { minimum: 0, maximum: 1 })
const requirePositive = (value, path) => {
  const number = requireNumber(value, path, { minimum: 0 })

  if (number === 0) {
    throw new Error(`バトルモーション設定: ${path}は0より大きい必要があります`)
  }

  return number
}

const requireGreaterThanOne = (value, path) => {
  const number = requireNumber(value, path)

  if (number <= 1) {
    throw new Error(`バトルモーション設定: ${path}は1より大きい必要があります`)
  }

  return number
}

const requireTeam = (team) => {
  if (!VALID_TEAMS.includes(team)) {
    throw new Error(`バトルモーション: teamは${VALID_TEAMS.join("、")}のいずれかが必要です`)
  }

  return team
}

export const validateBattleStatusConfig = (config) => {
  const battleStatus = requireObject(config, "battle_status")
  requireNumber(battleStatus.selected_shift_ratio, "battle_status.selected_shift_ratio", { minimum: 0 })
  requireNumber(
    battleStatus.selected_shift_duration_ms,
    "battle_status.selected_shift_duration_ms",
    { minimum: 0, integer: true }
  )
  for (const team of ["user", "enemy"]) {
    const color = requireObject(
      battleStatus[`${team}_background_color`],
      `battle_status.${team}_background_color`
    )
    for (const channel of ["r", "g", "b"]) {
      requireNumber(
        color[channel],
        `battle_status.${team}_background_color.${channel}`,
        { minimum: 0, maximum: 255, integer: true }
      )
    }
  }
  return battleStatus
}

const createAbortError = () => {
  const error = new Error("バトルモーションが中断されました")
  error.name = "AbortError"
  return error
}

const throwIfAborted = (signal) => {
  if (signal?.aborted) throw createAbortError()
}

const requireElement = (element, description) => {
  if (element === null || element === undefined || typeof element.animate !== "function") {
    throw new Error(`バトルモーション: ${description}が見つかりません`)
  }

  return element
}

const requireElements = (elements, description) => {
  if (!Array.isArray(elements)) {
    throw new Error(`バトルモーション: ${description}は配列である必要があります`)
  }

  elements.forEach((element) => requireElement(element, description))
  return elements
}

const requireStatusContainer = (element, description) => {
  if (element === null || element === undefined || typeof element.appendChild !== "function") {
    throw new Error(`バトルモーション: ${description}が見つかりません`)
  }

  return element
}

const moveStatusToBattlePosition = ({ handStatusElement, battleStatusElement, containerElement }) => {
  if (containerElement === null) return
  if (handStatusElement !== battleStatusElement) {
    throw new Error("バトルモーション: 本番ステータスは単一DOMである必要があります")
  }
  if (statusMovementStates.has(handStatusElement)) {
    throw new Error("バトルモーション: ステータスは既に戦闘位置へ移動済みです")
  }

  const homeParent = handStatusElement.parentElement
  if (homeParent === null || typeof homeParent.insertBefore !== "function") {
    throw new Error("バトルモーション: ステータスの手札位置を保存できません")
  }
  const ownerDocument = handStatusElement.ownerDocument
  if (ownerDocument === null || ownerDocument === undefined || typeof ownerDocument.createElement !== "function") {
    throw new Error("バトルモーション: ステータス位置予約要素を作成できません")
  }
  const placeholder = ownerDocument.createElement("div")
  placeholder.className = "battle__status-placeholder"
  placeholder.setAttribute("aria-hidden", "true")
  placeholder.dataset.team = handStatusElement.dataset?.team || ""
  placeholder.dataset.slot = handStatusElement.dataset?.slot || ""
  const homeNextSibling = handStatusElement.nextSibling
  homeParent.insertBefore(placeholder, homeNextSibling)
  statusMovementStates.set(handStatusElement, {
    homeParent,
    homeNextSibling,
    placeholder
  })
  requireStatusContainer(containerElement, "戦闘ステータス位置").appendChild(handStatusElement)
  handStatusElement.classList.add("battle__status-item--deployed")
}

const restoreStatusToHandPosition = (statusElement) => {
  const state = statusMovementStates.get(statusElement)
  if (state === undefined) return

  const placeholderIsHome = state.placeholder.parentElement === state.homeParent
  const nextSibling = placeholderIsHome
    ? state.placeholder
    : (state.homeNextSibling?.parentElement === state.homeParent ? state.homeNextSibling : null)
  state.homeParent.insertBefore(statusElement, nextSibling)
  state.placeholder.remove?.()
  if (state.placeholder.parentElement === state.homeParent) {
    state.homeParent.removeChild(state.placeholder)
  }
  statusElement.classList.remove("battle__status-item--deployed")
  statusMovementStates.delete(statusElement)
}

// 撃破確定後だけ手札側に予約していたstatusの高さを解放する。
export const discardStatusHandPlaceholder = (statusElement) => {
  const state = statusMovementStates.get(statusElement)
  if (state === undefined) return false

  state.placeholder.remove?.()
  if (state.placeholder.parentElement === state.homeParent) {
    state.homeParent.removeChild(state.placeholder)
  }
  statusMovementStates.delete(statusElement)
  return true
}

const wait = (durationMs, signal = null) => {
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

const applyFinalFrame = (element, frame) => {
  Object.entries(frame).forEach(([property, value]) => {
    if (property !== "offset" && property !== "easing") {
      element.style[property] = String(value)
    }
  })
}

const runAnimation = async (element, keyframes, durationMs, easing = "ease-out") => {
  const active = activeAnimations.get(element)
  if (active !== undefined) {
    active.cancelled()
    active.animation.commitStyles?.()
    active.animation.cancel?.()
    activeAnimations.delete(element)
  }

  const animation = element.animate(keyframes, {
    duration: durationMs,
    easing,
    fill: "forwards"
  })
  let cancelAnimation
  const cancelled = new Promise((resolve) => {
    cancelAnimation = resolve
  })
  const state = { animation, cancelled: cancelAnimation }
  activeAnimations.set(element, state)

  await Promise.race([animation.finished, cancelled])
  if (activeAnimations.get(element) !== state) return
  applyFinalFrame(element, keyframes[keyframes.length - 1])
  animation.commitStyles?.()
  animation.cancel?.()
  activeAnimations.delete(element)
}

const animateOpacity = async (element, opacity, durationMs) => {
  if (element === null || element === undefined) return

  requireElement(element, "ステータス表示")
  const view = element.ownerDocument?.defaultView || globalThis
  const display = typeof view.getComputedStyle === "function"
    ? view.getComputedStyle(element).display
    : null
  if (display === "none") {
    element.style.opacity = String(opacity)
    return
  }

  await runAnimation(
    element,
    [
      { opacity: Number.parseFloat(element.style.opacity || "1") },
      { opacity }
    ],
    durationMs
  )
}

const animateMobileHudTransform = async (mobileHudElement, toTransform, durationMs) => {
  if (mobileHudElement === null) return

  const view = mobileHudElement.ownerDocument?.defaultView || globalThis
  const display = typeof view.getComputedStyle === "function"
    ? view.getComputedStyle(mobileHudElement).display
    : null
  if (display === "none") {
    mobileHudElement.style.transform = toTransform
    return
  }

  await runAnimation(
    mobileHudElement,
    [
      { transform: mobileHudElement.style.transform || "translateY(0px)" },
      { transform: toTransform }
    ],
    durationMs
  )
}

const getBounds = (element, description) => {
  requireElement(element, description)
  const bounds = element.getBoundingClientRect()

  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new Error(`バトルモーション: ${description}の表示サイズを取得できません`)
  }

  return bounds
}

const findCardImage = (cardElement) => {
  if (typeof cardElement.querySelector !== "function") {
    throw new Error("バトルモーション: カード画像を検索できません")
  }

  const imageElement = cardElement.querySelector("img")

  if (imageElement === null) {
    throw new Error("バトルモーション: カード画像が見つかりません")
  }

  return imageElement
}

const createMotionStructure = (cardElement, team, config) => {
  requireElement(cardElement, "カード")
  requireTeam(team)
  const bounds = getBounds(cardElement, "カード")
  cardElement.style.perspective = `${ratioToPixels(
    bounds.width,
    config.card_3d.perspective_ratio
  )}px`

  if (typeof cardElement.querySelector !== "function" || !cardElement.ownerDocument) {
    return {
      positionElement: cardElement,
      sizeElement: cardElement,
      orientationElement: cardElement,
      flipElement: cardElement,
      selectionElement: cardElement,
      motionElement: cardElement,
      shadowElement: null
    }
  }

  const requirePart = (selector, description) => {
    const element = cardElement.querySelector(selector)
    if (element === null) {
      throw new Error(`バトルモーション: ${description}が見つかりません`)
    }
    return element
  }
  const positionElement = requirePart("[data-battle-animation-position]", "位置要素")
  const sizeElement = requirePart("[data-battle-animation-size]", "サイズ要素")
  const orientationElement = requirePart("[data-battle-animation-orientation]", "恒常向き要素")
  const flipElement = requirePart("[data-battle-animation-flip]", "表裏反転要素")
  const selectionElement = requirePart("[data-battle-animation-selection]", "選択要素")
  const motionElement = requirePart("[data-battle-animation-attack]", "攻撃要素")

  orientationElement.classList.toggle("battle-animation-orientation--enemy", team === "enemy")
  orientationElement.classList.toggle("battle-animation-orientation--user", team === "user")

  return {
    positionElement,
    sizeElement,
    orientationElement,
    flipElement,
    selectionElement,
    motionElement,
    shadowElement: cardElement.querySelector("[data-battle-animation-shadow]")
  }
}

const ensureDebugShadow = (cardElement, team, config) => {
  const parts = createMotionStructure(cardElement, team, config)

  if (parts.shadowElement !== null || !cardElement.ownerDocument) return parts

  const shadowElement = cardElement.ownerDocument.createElement("div")
  shadowElement.className = "battle-animation-shadow"
  shadowElement.dataset.battleAnimationShadow = ""
  shadowElement.setAttribute("aria-hidden", "true")
  parts.motionElement.prepend(shadowElement)

  return { ...parts, shadowElement }
}

const warnMissingShadow = (cardElement) => {
  if (warnedMissingShadowCards.has(cardElement)) return

  warnedMissingShadowCards.add(cardElement)
  console.warn("バトルモーション: 攻撃用の影がないため、カード本体だけを動かします")
}

const getMotionElement = (cardElement, team, config) => {
  const parts = createMotionStructure(cardElement, team, config)
  return parts.motionElement
}

const getCardParts = (cardElement, team, config) => createMotionStructure(cardElement, team, config)

const getFrontImageUrl = (cardElement) => {
  const imageElement = findCardImage(cardElement)
  let frontImageUrl = cardFrontImageUrls.get(cardElement)

  if (frontImageUrl === undefined) {
    frontImageUrl = imageElement.currentSrc || imageElement.src

    if (!frontImageUrl) {
      throw new Error("バトルモーション: 表面カード画像URLを取得できません")
    }

    cardFrontImageUrls.set(cardElement, frontImageUrl)
  }

  return { imageElement, frontImageUrl }
}

const requireCardBackUrl = (cardBackUrl) => {
  if (typeof cardBackUrl !== "string" || cardBackUrl.length === 0) {
    throw new Error("バトルモーション: card_back.PNGのURLが必要です")
  }

  return cardBackUrl
}

// YAML全体の必須キーと数値範囲を検証する。
export const validateBattleAnimationConfig = (config) => {
  const root = requireObject(config, "root")
  const card3d = requireObject(root.card_3d, "card_3d")
  requirePositive(card3d.perspective_ratio, "card_3d.perspective_ratio")

  const cardEntry = requireObject(root.card_entry, "card_entry")
  requireDuration(cardEntry.duration_ms, "card_entry.duration_ms")
  requireNumber(cardEntry.start_translate_y_ratio, "card_entry.start_translate_y_ratio", { minimum: 0 })

  const battleStart = requireObject(root.battle_start, "battle_start")
  requireDuration(battleStart.fade_in_duration_ms, "battle_start.fade_in_duration_ms")
  requireDuration(battleStart.hold_duration_ms, "battle_start.hold_duration_ms")
  requireDuration(battleStart.fade_out_duration_ms, "battle_start.fade_out_duration_ms")
  requirePositive(battleStart.start_scale_multiplier, "battle_start.start_scale_multiplier")
  requirePositive(battleStart.end_scale_multiplier, "battle_start.end_scale_multiplier")

  validateBattleStatusConfig(root.battle_status)

  const choiceStart = requireObject(root.choice_start, "choice_start")
  requireDuration(choiceStart.duration_ms, "choice_start.duration_ms")
  requireRatio(choiceStart.dim_opacity_ratio, "choice_start.dim_opacity_ratio")
  requirePositive(choiceStart.prompt_start_scale_multiplier, "choice_start.prompt_start_scale_multiplier")
  requirePositive(choiceStart.prompt_end_scale_multiplier, "choice_start.prompt_end_scale_multiplier")

  const cardSelect = requireObject(root.card_select, "card_select")
  requireDuration(cardSelect.duration_ms, "card_select.duration_ms")
  requireNumber(cardSelect.translate_y_ratio, "card_select.translate_y_ratio")
  requireRatio(cardSelect.other_opacity_ratio, "card_select.other_opacity_ratio")

  const cardDeselect = requireObject(root.card_deselect, "card_deselect")
  requireDuration(cardDeselect.duration_ms, "card_deselect.duration_ms")

  const cardCover = requireObject(root.card_cover, "card_cover")
  requireDuration(cardCover.duration_ms, "card_cover.duration_ms")
  requireNumber(cardCover.rotate_y_deg, "card_cover.rotate_y_deg")

  const handRetreat = requireObject(root.hand_retreat, "hand_retreat")
  requireDuration(handRetreat.duration_ms, "hand_retreat.duration_ms")
  requireNumber(handRetreat.translate_y_ratio, "hand_retreat.translate_y_ratio", { minimum: 0 })

  const cardToBattle = requireObject(root.card_to_battle, "card_to_battle")
  requireDuration(cardToBattle.duration_ms, "card_to_battle.duration_ms")
  requireNumber(cardToBattle.lift_z_ratio, "card_to_battle.lift_z_ratio", { minimum: 0 })
  requireDuration(cardToBattle.hand_status_hide_duration_ms, "card_to_battle.hand_status_hide_duration_ms")
  requireDuration(cardToBattle.battle_status_show_duration_ms, "card_to_battle.battle_status_show_duration_ms")

  const cardReveal = requireObject(root.card_reveal, "card_reveal")
  requireDuration(cardReveal.delay_ms, "card_reveal.delay_ms")
  requireDuration(cardReveal.duration_ms, "card_reveal.duration_ms")
  requireNumber(cardReveal.rotate_y_deg, "card_reveal.rotate_y_deg")

  const attackLift = requireObject(root.attack_lift, "attack_lift")
  requireDuration(attackLift.duration_ms, "attack_lift.duration_ms")
  requireGreaterThanOne(attackLift.deceleration_power, "attack_lift.deceleration_power")
  requireDuration(attackLift.peak_hold_duration_ms, "attack_lift.peak_hold_duration_ms")
  requireRatio(attackLift.rotation_peak_at_ratio, "attack_lift.rotation_peak_at_ratio")
  requireNumber(attackLift.translate_z_ratio, "attack_lift.translate_z_ratio", { minimum: 0 })
  requireNumber(attackLift.rotate_z_deg, "attack_lift.rotate_z_deg")
  requireNumber(attackLift.rotate_y_deg, "attack_lift.rotate_y_deg")
  requireRatio(attackLift.origin_x_ratio, "attack_lift.origin_x_ratio")
  requireRatio(attackLift.origin_y_ratio, "attack_lift.origin_y_ratio")
  requirePositive(attackLift.scale_multiplier, "attack_lift.scale_multiplier")

  const attackSlam = requireObject(root.attack_slam, "attack_slam")
  requireDuration(attackSlam.duration_ms, "attack_slam.duration_ms")
  requirePositive(attackSlam.scale_multiplier, "attack_slam.scale_multiplier")

  const attackShadow = requireObject(root.attack_shadow, "attack_shadow")
  requireNumber(attackShadow.translate_x_ratio, "attack_shadow.translate_x_ratio")
  requireNumber(attackShadow.translate_y_ratio, "attack_shadow.translate_y_ratio")
  requirePositive(attackShadow.lift_scale_multiplier, "attack_shadow.lift_scale_multiplier")
  requireRatio(attackShadow.lift_opacity_ratio, "attack_shadow.lift_opacity_ratio")
  requirePositive(attackShadow.slam_scale_multiplier, "attack_shadow.slam_scale_multiplier")
  requireRatio(attackShadow.slam_opacity_ratio, "attack_shadow.slam_opacity_ratio")

  const hitShake = requireObject(root.hit_shake, "hit_shake")
  requireDuration(hitShake.duration_ms, "hit_shake.duration_ms")
  requireNumber(hitShake.translate_x_ratio, "hit_shake.translate_x_ratio", { minimum: 0 })
  requireNumber(hitShake.translate_y_ratio, "hit_shake.translate_y_ratio", { minimum: 0 })
  requireNumber(hitShake.rotate_z_deg, "hit_shake.rotate_z_deg", { minimum: 0 })
  requireNumber(hitShake.count, "hit_shake.count", { minimum: 1, integer: true })
  requireRatio(hitShake.decay_multiplier, "hit_shake.decay_multiplier")

  const damageNumber = requireObject(root.damage_number, "damage_number")
  requireDuration(damageNumber.hold_duration_ms, "damage_number.hold_duration_ms")
  requireDuration(damageNumber.fade_duration_ms, "damage_number.fade_duration_ms")
  requirePositive(damageNumber.start_scale_multiplier, "damage_number.start_scale_multiplier")
  requirePositive(damageNumber.peak_scale_multiplier, "damage_number.peak_scale_multiplier")
  requireNumber(damageNumber.translate_y_ratio, "damage_number.translate_y_ratio")

  const numberChange = requireObject(root.number_change, "number_change")
  requireDuration(numberChange.duration_ms, "number_change.duration_ms")
  requirePositive(numberChange.full_duration_change, "number_change.full_duration_change")
  requireDuration(numberChange.min_duration_ms, "number_change.min_duration_ms")

  if (numberChange.min_duration_ms > numberChange.duration_ms) {
    throw new Error("バトルモーション設定: number_change.min_duration_msはduration_ms以下である必要があります")
  }

  const defeatFade = requireObject(root.defeat_fade, "defeat_fade")
  requireDuration(defeatFade.duration_ms, "defeat_fade.duration_ms")
  requirePositive(defeatFade.scale_multiplier, "defeat_fade.scale_multiplier")
  requireRatio(defeatFade.end_opacity_ratio, "defeat_fade.end_opacity_ratio")

  const cardToHand = requireObject(root.card_to_hand, "card_to_hand")
  requireDuration(cardToHand.duration_ms, "card_to_hand.duration_ms")
  requireNumber(cardToHand.lift_z_ratio, "card_to_hand.lift_z_ratio", { minimum: 0 })
  requireDuration(cardToHand.battle_status_hide_duration_ms, "card_to_hand.battle_status_hide_duration_ms")
  requireDuration(cardToHand.hand_status_show_duration_ms, "card_to_hand.hand_status_show_duration_ms")

  const handRestore = requireObject(root.hand_restore, "hand_restore")
  requireDuration(handRestore.duration_ms, "hand_restore.duration_ms")
  requireRatio(handRestore.opacity_ratio, "hand_restore.opacity_ratio")

  const revengeBuff = requireObject(root.revenge_buff, "revenge_buff")
  requireDuration(revengeBuff.duration_ms, "revenge_buff.duration_ms")
  requireDuration(revengeBuff.lift_duration_ms, "revenge_buff.lift_duration_ms")
  requireNumber(revengeBuff.translate_z_ratio, "revenge_buff.translate_z_ratio", { minimum: 0 })
  requirePositive(revengeBuff.scale_multiplier, "revenge_buff.scale_multiplier")
  const revengeColor = requireObject(revengeBuff.color, "revenge_buff.color")
  requireNumber(revengeColor.r, "revenge_buff.color.r", { minimum: 0, maximum: 255, integer: true })
  requireNumber(revengeColor.g, "revenge_buff.color.g", { minimum: 0, maximum: 255, integer: true })
  requireNumber(revengeColor.b, "revenge_buff.color.b", { minimum: 0, maximum: 255, integer: true })
  requireRatio(revengeBuff.max_opacity_ratio, "revenge_buff.max_opacity_ratio")
  requireDuration(revengeBuff.color_in_duration_ms, "revenge_buff.color_in_duration_ms")
  requireDuration(revengeBuff.color_out_duration_ms, "revenge_buff.color_out_duration_ms")

  if (revengeBuff.lift_duration_ms > revengeBuff.duration_ms) {
    throw new Error("バトルモーション設定: revenge_buff.lift_duration_msはduration_ms以下である必要があります")
  }

  if (revengeBuff.color_in_duration_ms + revengeBuff.color_out_duration_ms > revengeBuff.duration_ms) {
    throw new Error("バトルモーション設定: revenge_buffの色変化時間合計はduration_ms以下である必要があります")
  }

  return root
}

// 寸法に対するYAML倍率をpxへ変換する。
export const ratioToPixels = (dimension, ratio) => {
  requireNumber(dimension, "dimension", { minimum: 0 })
  requireNumber(ratio, "ratio")
  return dimension * ratio
}

// チームごとの画面上下方向を返す。
export const getTeamDirection = (team) => requireTeam(team) === "user" ? 1 : -1

// attack_lift.duration_msに対する正規化進捗tから、持ち上げ位置だけの減速進捗を返す。
export const calculateAttackLiftEasedProgress = ({ progress, decelerationPower }) => {
  const t = requireRatio(progress, "attack_lift.progress")
  const p = requireGreaterThanOne(decelerationPower, "attack_lift.deceleration_power")
  return ((p * t) - (t ** p)) / (p - 1)
}

const attackLiftRotationProgress = ({ progress, peak }) => {
  if (progress === peak) return 1
  if (progress < peak) return peak === 0 ? 1 : progress / peak
  return peak === 1 ? 1 : (1 - progress) / (1 - peak)
}

// 攻撃持ち上げ中の位置だけを減速させ、回転・拡大は従来の時間進捗で生成する。
export const buildAttackLiftKeyframes = ({ cardWidth, attackLiftConfig }) => {
  requireNumber(cardWidth, "cardWidth", { minimum: 0 })
  const lift = requireObject(attackLiftConfig, "attack_lift")
  const peak = requireRatio(lift.rotation_peak_at_ratio, "attack_lift.rotation_peak_at_ratio")
  const decelerationPower = requireGreaterThanOne(
    lift.deceleration_power,
    "attack_lift.deceleration_power"
  )
  const translateZ = ratioToPixels(cardWidth, lift.translate_z_ratio)
  const offsets = Array.from({ length: 101 }, (_, index) => index / 100)
  if (!offsets.includes(peak)) offsets.push(peak)
  offsets.sort((left, right) => left - right)

  return offsets.map((progress) => {
    const easedProgress = calculateAttackLiftEasedProgress({ progress, decelerationPower })
    const rotationProgress = attackLiftRotationProgress({ progress, peak })
    const scale = 1 + ((lift.scale_multiplier - 1) * progress)

    return {
      offset: progress,
      transform: `translateZ(${translateZ * easedProgress}px) rotateY(${lift.rotate_y_deg * rotationProgress}deg) rotateZ(${lift.rotate_z_deg * rotationProgress}deg) scale(${scale})`
    }
  })
}

// 数値変化量に応じてmin_duration_msからduration_msまで線形補間する。
export const calculateNumberChangeDuration = ({ fromValue, toValue, numberChangeConfig }) => {
  requireNumber(fromValue, "fromValue")
  requireNumber(toValue, "toValue")
  const section = requireObject(numberChangeConfig, "number_change")
  const duration = requireDuration(section.duration_ms, "number_change.duration_ms")
  const minimumDuration = requireDuration(section.min_duration_ms, "number_change.min_duration_ms")
  const fullDurationChange = requirePositive(
    section.full_duration_change,
    "number_change.full_duration_change"
  )
  const clampedTarget = Math.max(0, toValue)
  const change = Math.abs(clampedTarget - Math.max(0, fromValue))
  const interpolationRatio = Math.min(change / fullDurationChange, 1)

  return minimumDuration + ((duration - minimumDuration) * interpolationRatio)
}

// カードを画面外から手札位置へ登場させる。
export const playCardEntry = async ({ cardElement, team, config }) => {
  const root = validateBattleAnimationConfig(config)
  requireElement(cardElement, "登場カード")
  const bounds = getBounds(cardElement, "登場カード")
  const { positionElement } = getCardParts(cardElement, team, root)
  const startY = ratioToPixels(bounds.height, root.card_entry.start_translate_y_ratio) * getTeamDirection(team)

  await runAnimation(
    positionElement,
    [
      { transform: `translateY(${startY}px)` },
      { transform: "translateY(0px)" }
    ],
    root.card_entry.duration_ms
  )
}

// バトル開始表示をフェードイン・保持・フェードアウトする。
export const playBattleStart = async ({ messageElement, config }) => {
  const root = validateBattleAnimationConfig(config)
  requireElement(messageElement, "バトル開始表示")
  messageElement.style.visibility = "visible"

  await runAnimation(
    messageElement,
    [
      {
        opacity: 0,
        transform: `translate(-50%, -50%) scale(${root.battle_start.start_scale_multiplier})`
      },
      {
        opacity: 1,
        transform: `translate(-50%, -50%) scale(${root.battle_start.end_scale_multiplier})`
      }
    ],
    root.battle_start.fade_in_duration_ms
  )
  await wait(root.battle_start.hold_duration_ms)
  await runAnimation(
    messageElement,
    [
      {
        opacity: 1,
        transform: `translate(-50%, -50%) scale(${root.battle_start.end_scale_multiplier})`
      },
      {
        opacity: 0,
        transform: `translate(-50%, -50%) scale(${root.battle_start.end_scale_multiplier})`
      }
    ],
    root.battle_start.fade_out_duration_ms
  )
  messageElement.style.visibility = "hidden"
}

// カード選択開始時に対象外領域を暗くし、案内を表示する。
export const showCardChoice = async ({ dimElement, promptElement, config }) => {
  const root = validateBattleAnimationConfig(config)
  requireElement(dimElement, "選択時の暗転領域")
  requireElement(promptElement, "カード選択案内")
  dimElement.style.visibility = "visible"
  promptElement.style.visibility = "visible"

  await Promise.all([
    runAnimation(
      dimElement,
      [{ opacity: 0 }, { opacity: root.choice_start.dim_opacity_ratio }],
      root.choice_start.duration_ms
    ),
    runAnimation(
      promptElement,
      [
        {
          opacity: 0,
          transform: `translate(-50%, -50%) scale(${root.choice_start.prompt_start_scale_multiplier})`
        },
        {
          opacity: 1,
          transform: `translate(-50%, -50%) scale(${root.choice_start.prompt_end_scale_multiplier})`
        }
      ],
      root.choice_start.duration_ms
    )
  ])
}

// カード選択案内と暗転兼モザイクを同じ状態として即時に解除する。
export const hideCardChoice = ({ dimElement, promptElement }) => {
  requireElement(dimElement, "選択時の暗転兼モザイク領域")
  requireElement(promptElement, "カード選択案内")
  dimElement.style.visibility = "hidden"
  dimElement.style.opacity = "0"
  promptElement.style.visibility = "hidden"
  promptElement.style.opacity = "0"
}

// ユーザーの選択枚数に依存せず、選択画面中の生存エネミーカードを非選択カードと同じ濃さへ暗くする。
export const dimCardsForChoice = async ({ cardElements, config }) => {
  const root = validateBattleAnimationConfig(config)
  requireElements(cardElements, "選択画面で暗くするカード")

  await Promise.all(cardElements.map((cardElement) => animateOpacity(
    cardElement,
    root.card_select.other_opacity_ratio,
    root.card_select.duration_ms
  )))
}

// 選択カードのselection階層だけをY方向へ移動し、その他カードを暗くする。
export const selectCard = async ({ cardElement, otherCardElements, team = "user", config }) => {
  const root = validateBattleAnimationConfig(config)
  requireElement(cardElement, "選択カード")
  requireElements(otherCardElements, "非選択カード")
  const bounds = getBounds(cardElement, "選択カード")
  const { selectionElement } = getCardParts(cardElement, team, root)
  const mobileHudElement = cardElement.querySelector?.("[data-battle-mobile-hud]") || null
  const translateY = ratioToPixels(bounds.height, root.card_select.translate_y_ratio)

  await Promise.all([
    runAnimation(
      selectionElement,
      [
        { transform: selectionElement.style.transform || "translateY(0px)" },
        { transform: `translateY(${translateY}px)` }
      ],
      root.card_select.duration_ms
    ),
    animateMobileHudTransform(
      mobileHudElement,
      `translateY(${translateY}px)`,
      root.card_select.duration_ms
    ),
    ...otherCardElements.map((otherCard) => animateOpacity(
      otherCard,
      root.card_select.other_opacity_ratio,
      root.card_select.duration_ms
    ))
  ])
}

// 選択カードとその他カードを通常の手札状態へ戻す。
export const deselectCard = async ({ cardElement, otherCardElements, config }) => {
  const root = validateBattleAnimationConfig(config)
  requireElement(cardElement, "選択解除カード")
  requireElements(otherCardElements, "非選択カード")

  const { selectionElement } = getCardParts(cardElement, cardElement.dataset?.team || "user", root)
  const mobileHudElement = cardElement.querySelector?.("[data-battle-mobile-hud]") || null

  await Promise.all([
    runAnimation(
      selectionElement,
      [
        { transform: selectionElement.style.transform || "translateY(0px)" },
        { transform: "translateY(0px)" }
      ],
      root.card_deselect.duration_ms
    ),
    animateMobileHudTransform(mobileHudElement, "translateY(0px)", root.card_deselect.duration_ms),
    ...otherCardElements.map((otherCard) => animateOpacity(
      otherCard,
      1,
      root.card_deselect.duration_ms
    ))
  ])
}

// 表面カードをY軸回転の中間でcard_back.PNGへ切り替える。
export const coverCard = async ({ cardElement, team, cardBackUrl, config }) => {
  const root = validateBattleAnimationConfig(config)
  requireElement(cardElement, "伏せるカード")
  requireCardBackUrl(cardBackUrl)
  const { flipElement } = getCardParts(cardElement, team, root)
  const { imageElement } = getFrontImageUrl(cardElement)
  const halfDuration = root.card_cover.duration_ms / 2

  await runAnimation(
    flipElement,
    [{ transform: "rotateY(0deg)" }, { transform: `rotateY(${root.card_cover.rotate_y_deg / 2}deg)` }],
    halfDuration,
    "linear"
  )
  imageElement.src = cardBackUrl
  await runAnimation(
    flipElement,
    [
      { transform: `rotateY(${root.card_cover.rotate_y_deg / 2}deg)` },
      { transform: `rotateY(${root.card_cover.rotate_y_deg}deg)` }
    ],
    halfDuration,
    "linear"
  )
}

// 戦闘可能な全手札をチーム別平均Xへ集め、ユーザーカード高を基準に画面外へ退避する。
export const retreatHandCards = async ({
  cardElements,
  team,
  userReferenceCardElement = null,
  config
}) => {
  const root = validateBattleAnimationConfig(config)
  requireElements(cardElements, "退避カード")
  const direction = getTeamDirection(team)
  const battleableCards = cardElements.filter((cardElement) => (
    cardElement.dataset?.canBattle === undefined || cardElement.dataset.canBattle === "true"
  ))
  if (battleableCards.length === 0) return

  const referenceElement = userReferenceCardElement || battleableCards[0]
  const userCardHeight = getBounds(referenceElement, "ユーザー手札基準カード").height
  const cardBounds = battleableCards.map((cardElement) => ({
    cardElement,
    bounds: getBounds(cardElement, "退避カード")
  }))
  const averageX = cardBounds.reduce(
    (total, { bounds }) => total + bounds.left + (bounds.width / 2),
    0
  ) / cardBounds.length
  const translateY = ratioToPixels(userCardHeight, root.hand_retreat.translate_y_ratio) * direction

  await Promise.all(cardBounds.flatMap(({ cardElement, bounds }) => {
    const { positionElement, selectionElement } = getCardParts(cardElement, team, root)
    const mobileHudElement = cardElement.querySelector?.("[data-battle-mobile-hud]") || null
    if (mobileHudElement !== null) mobileHudElement.style.transform = "translateY(0px)"
    const centerX = bounds.left + (bounds.width / 2)
    const centerY = bounds.top + (bounds.height / 2)
    const translateX = averageX - centerX
    cardElement.style.opacity = "1"
    cardMovementStates.set(cardElement, {
      team,
      homeCenterX: centerX,
      homeCenterY: centerY,
      originalWidth: bounds.width,
      originalHeight: bounds.height,
      retreatX: translateX,
      retreatY: translateY,
      targetScale: 1,
      deployed: false
    })

    return [
      runAnimation(
        positionElement,
        [
          { transform: positionElement.style.transform || "translate(0px, 0px)" },
          { transform: `translate(${translateX}px, ${translateY}px)` }
        ],
        root.hand_retreat.duration_ms
      ),
      runAnimation(
        selectionElement,
        [
          { transform: selectionElement.style.transform || "translateY(0px)" },
          { transform: "translateY(0px)" }
        ],
        root.hand_retreat.duration_ms
      )
    ]
  }))
}

// 画面外の選出カードだけを戦闘エリア中心Xへ瞬間移動し、Y方向に出撃させる。
export const moveCardToBattle = async ({
  cardElement,
  team,
  battleAreaElement,
  handStatusElement,
  battleStatusElement,
  battleStatusContainerElement = null,
  userReferenceCardElement = null,
  config
}) => {
  const root = validateBattleAnimationConfig(config)
  requireElement(cardElement, "出撃カード")
  requireElement(battleAreaElement, "戦闘エリア")
  const state = cardMovementStates.get(cardElement)
  if (state === undefined) {
    throw new Error("バトルモーション: 出撃前に全手札の退避が完了していません")
  }
  if (state.team !== requireTeam(team)) {
    throw new Error("バトルモーション: 退避時と出撃時のteamが一致しません")
  }
  const battleBounds = getBounds(battleAreaElement, "戦闘エリア")
  const { positionElement, sizeElement } = getCardParts(cardElement, team, root)
  let targetScale = 1

  if (team === "enemy") {
    const userBounds = getBounds(userReferenceCardElement, "ユーザー手札基準カード")
    targetScale = userBounds.width / state.originalWidth
  }

  const battleCenterX = battleBounds.left + (battleBounds.width / 2)
  const battleCenterY = battleBounds.top + (battleBounds.height / 2)
  const translateX = battleCenterX - state.homeCenterX
  const translateY = battleCenterY - state.homeCenterY
  const offscreenTransform = `translate(${translateX}px, ${state.retreatY}px)`
  positionElement.style.transform = offscreenTransform
  sizeElement.style.transform = `scale(${targetScale})`

  await animateOpacity(
    handStatusElement,
    0,
    root.card_to_battle.hand_status_hide_duration_ms
  )
  moveStatusToBattlePosition({
    handStatusElement,
    battleStatusElement,
    containerElement: battleStatusContainerElement
  })

  const liftZ = ratioToPixels(state.originalWidth, root.card_to_battle.lift_z_ratio)
  const finalTransform = `translate(${translateX}px, ${translateY}px) translateZ(0px)`

  await runAnimation(
    positionElement,
    [
      { offset: 0, transform: `${offscreenTransform} translateZ(0px)` },
      {
        offset: 0.5,
        transform: `translate(${translateX}px, ${(state.retreatY + translateY) / 2}px) translateZ(${liftZ}px)`
      },
      { offset: 1, transform: finalTransform }
    ],
    root.card_to_battle.duration_ms
  )

  cardMovementStates.set(cardElement, {
    ...state,
    translateX,
    translateY,
    targetScale,
    finalTransform,
    deployed: true
  })
}

// 両カードの表返し完了後に、出撃位置へ移した同一status DOMを表示する。
export const showBattleStatus = async ({ battleStatusElement, config }) => {
  const root = validateBattleAnimationConfig(config)
  await animateOpacity(
    battleStatusElement,
    1,
    root.card_to_battle.battle_status_show_duration_ms
  )
}

// 裏面カードをY軸回転の中間で元の表面画像へ戻す。
export const revealCard = async ({ cardElement, team, config, waitForDelay = true }) => {
  const root = validateBattleAnimationConfig(config)
  requireElement(cardElement, "表返しカード")
  const { flipElement } = getCardParts(cardElement, team, root)
  const { imageElement, frontImageUrl } = getFrontImageUrl(cardElement)
  const halfDuration = root.card_reveal.duration_ms / 2
  if (waitForDelay) await wait(root.card_reveal.delay_ms)

  await runAnimation(
    flipElement,
    [
      { transform: `rotateY(${root.card_reveal.rotate_y_deg}deg)` },
      { transform: `rotateY(${root.card_reveal.rotate_y_deg / 2}deg)` }
    ],
    halfDuration,
    "linear"
  )
  imageElement.src = frontImageUrl
  await runAnimation(
    flipElement,
    [{ transform: `rotateY(${root.card_reveal.rotate_y_deg / 2}deg)` }, { transform: "rotateY(0deg)" }],
    halfDuration,
    "linear"
  )
}

// 攻撃カードを回転ピーク後も上昇させ、終了時に水平へ戻す。
export const playAttackLift = async ({ cardElement, shadowElement = null, team, config }) => {
  const root = validateBattleAnimationConfig(config)
  const motionElement = getMotionElement(cardElement, team, root)
  const cardBounds = getBounds(motionElement, "攻撃カード")
  motionElement.style.transformOrigin = `${ratioToPixels(cardBounds.width, root.attack_lift.origin_x_ratio)}px ${ratioToPixels(cardBounds.height, root.attack_lift.origin_y_ratio)}px`
  const animations = [runAnimation(
    motionElement,
    buildAttackLiftKeyframes({ cardWidth: cardBounds.width, attackLiftConfig: root.attack_lift }),
    root.attack_lift.duration_ms,
    "linear"
  )]

  if (shadowElement === null) {
    warnMissingShadow(cardElement)
  } else {
    requireElement(shadowElement, "攻撃カードの影")
    const shadowX = ratioToPixels(cardBounds.width, root.attack_shadow.translate_x_ratio)
    const shadowY = ratioToPixels(cardBounds.height, root.attack_shadow.translate_y_ratio)
    animations.push(runAnimation(
      shadowElement,
      [
        { transform: "translate(0px, 0px) scale(1)", opacity: 0.68 },
        {
          transform: `translate(${shadowX}px, ${shadowY}px) scale(${root.attack_shadow.lift_scale_multiplier})`,
          opacity: root.attack_shadow.lift_opacity_ratio
        }
      ],
      root.attack_lift.duration_ms,
      "linear"
    ))
  }

  await Promise.all(animations)
}

// 水平な攻撃カードを追加回転なしで盤面へ落とす。
export const playAttackSlam = async ({ cardElement, shadowElement = null, team, config }) => {
  const root = validateBattleAnimationConfig(config)
  const motionElement = getMotionElement(cardElement, team, root)
  const cardBounds = getBounds(motionElement, "攻撃カード")
  const liftZ = ratioToPixels(cardBounds.width, root.attack_lift.translate_z_ratio)
  const animations = [runAnimation(
    motionElement,
    [
      { transform: `translateZ(${liftZ}px) rotateY(0deg) rotateZ(0deg) scale(${root.attack_lift.scale_multiplier})` },
      { transform: `translateZ(0px) rotateY(0deg) rotateZ(0deg) scale(${root.attack_slam.scale_multiplier})` }
    ],
    root.attack_slam.duration_ms,
    "linear"
  )]

  if (shadowElement === null) {
    warnMissingShadow(cardElement)
  } else {
    requireElement(shadowElement, "攻撃カードの影")
    const shadowX = ratioToPixels(cardBounds.width, root.attack_shadow.translate_x_ratio)
    const shadowY = ratioToPixels(cardBounds.height, root.attack_shadow.translate_y_ratio)
    animations.push(runAnimation(
      shadowElement,
      [
        {
          transform: `translate(${shadowX}px, ${shadowY}px) scale(${root.attack_shadow.lift_scale_multiplier})`,
          opacity: root.attack_shadow.lift_opacity_ratio
        },
        {
          transform: `translate(0px, 0px) scale(${root.attack_shadow.slam_scale_multiplier})`,
          opacity: root.attack_shadow.slam_opacity_ratio
        }
      ],
      root.attack_slam.duration_ms,
      "linear"
    ))
  }

  await Promise.all(animations)
}

// 持ち上げと落下を連結し、着地時にonImpactを正確に1回実行する。
export const playAttackMotion = async ({
  cardElement,
  shadowElement = null,
  team,
  config,
  signal = null,
  onImpact = null
}) => {
  if (onImpact !== null && typeof onImpact !== "function") {
    throw new Error("バトルモーション: onImpactは関数である必要があります")
  }

  const root = validateBattleAnimationConfig(config)
  throwIfAborted(signal)
  await playAttackLift({ cardElement, shadowElement, team, config })
  await wait(root.attack_lift.peak_hold_duration_ms, signal)
  throwIfAborted(signal)
  await playAttackSlam({ cardElement, shadowElement, team, config })
  throwIfAborted(signal)

  if (onImpact !== null) {
    await onImpact()
  }
}

// 被弾カードを強い揺れから弱い揺れへ減衰させる。
export const playHitShake = async ({ cardElement, team, config }) => {
  const root = validateBattleAnimationConfig(config)
  const motionElement = getMotionElement(cardElement, team, root)
  const bounds = getBounds(motionElement, "被弾カード")
  const keyframes = [{ offset: 0, transform: "translate(0px, 0px) rotateZ(0deg)" }]

  for (let index = 0; index < root.hit_shake.count; index += 1) {
    const strength = root.hit_shake.decay_multiplier ** index
    const sign = index % 2 === 0 ? 1 : -1
    const translateX = ratioToPixels(bounds.width, root.hit_shake.translate_x_ratio) * strength * sign
    const translateY = ratioToPixels(bounds.height, root.hit_shake.translate_y_ratio) * strength * -sign
    const rotateZ = root.hit_shake.rotate_z_deg * strength * sign
    keyframes.push({
      offset: (index + 1) / (root.hit_shake.count + 1),
      transform: `translate(${translateX}px, ${translateY}px) rotateZ(${rotateZ}deg)`
    })
  }

  keyframes.push({ offset: 1, transform: "translate(0px, 0px) rotateZ(0deg)" })
  await runAnimation(motionElement, keyframes, root.hit_shake.duration_ms, "linear")
}

// カード上へダメージ数値を表示し、保持後に消してDOMから除去する。
export const showDamageNumber = async ({ cardElement, damage, team, config }) => {
  const root = validateBattleAnimationConfig(config)
  requireNumber(damage, "damage")
  const motionElement = getMotionElement(cardElement, team, root)
  const bounds = getBounds(motionElement, "ダメージ表示カード")

  if (!cardElement.ownerDocument) {
    throw new Error("バトルモーション: ダメージ数値要素を作成できません")
  }

  const numberElement = cardElement.ownerDocument.createElement("span")
  numberElement.className = "battle-animation-damage-number"
  numberElement.textContent = String(damage)
  motionElement.append(numberElement)

  try {
    await runAnimation(
      numberElement,
      [
        {
          opacity: 1,
          transform: `translate(-50%, 0px) scale(${root.damage_number.start_scale_multiplier})`
        },
        {
          opacity: 1,
          transform: `translate(-50%, 0px) scale(${root.damage_number.peak_scale_multiplier})`
        }
      ],
      root.damage_number.hold_duration_ms
    )
    await runAnimation(
      numberElement,
      [
        {
          opacity: 1,
          transform: `translate(-50%, 0px) scale(${root.damage_number.peak_scale_multiplier})`
        },
        {
          opacity: 0,
          transform: `translate(-50%, ${ratioToPixels(bounds.height, root.damage_number.translate_y_ratio)}px) scale(${root.damage_number.peak_scale_multiplier})`
        }
      ],
      root.damage_number.fade_duration_ms
    )
  } finally {
    numberElement.remove()
  }
}

// HPやSPDの表示値を比例時間で変化させ、0未満にはしない。
export const animateNumberChange = async ({ numberElement, fromValue, toValue, config }) => {
  const root = validateBattleAnimationConfig(config)
  requireNumber(fromValue, "fromValue")
  requireNumber(toValue, "toValue")

  if (numberElement === null || numberElement === undefined) {
    throw new Error("バトルモーション: 数値表示要素が見つかりません")
  }

  const startValue = Math.max(0, fromValue)
  const targetValue = Math.max(0, toValue)
  const duration = calculateNumberChangeDuration({
    fromValue: startValue,
    toValue: targetValue,
    numberChangeConfig: root.number_change
  })

  if (duration === 0) {
    numberElement.textContent = String(Math.round(targetValue))
    return
  }

  const view = numberElement.ownerDocument?.defaultView || globalThis
  const requestFrame = view.requestAnimationFrame?.bind(view) || ((callback) => globalThis.setTimeout(() => callback(Date.now()), 16))

  await new Promise((resolve) => {
    let startedAt = null
    const update = (timestamp) => {
      if (startedAt === null) startedAt = timestamp
      const progress = Math.min((timestamp - startedAt) / duration, 1)
      numberElement.textContent = String(Math.round(startValue + ((targetValue - startValue) * progress)))

      if (progress < 1) {
        requestFrame(update)
      } else {
        resolve()
      }
    }

    requestFrame(update)
  })
}

// 通常撃破カードをdefeat_fade設定で透明化する。
export const fadeDefeatedCard = async ({ cardElement, team, config }) => {
  const root = validateBattleAnimationConfig(config)
  requireElement(cardElement, "撃破カード")
  const motionElement = getMotionElement(cardElement, team, root)

  await Promise.all([
    runAnimation(
      cardElement,
      [{ opacity: 1 }, { opacity: root.defeat_fade.end_opacity_ratio }],
      root.defeat_fade.duration_ms
    ),
    runAnimation(
      motionElement,
      [{ transform: motionElement.style.transform || "none" }, { transform: `scale(${root.defeat_fade.scale_multiplier})` }],
      root.defeat_fade.duration_ms
    )
  ])
  cardElement.style.visibility = "hidden"
}

// 戦闘エリアのカードを手札位置へ戻し、敵だけ元の実測サイズへ縮小する。
export const moveCardToHand = async ({
  cardElement,
  team,
  handStatusElement,
  battleStatusElement,
  config
}) => {
  const root = validateBattleAnimationConfig(config)
  requireElement(cardElement, "帰還カード")
  requireTeam(team)
  const state = cardMovementStates.get(cardElement)

  if (state === undefined) {
    throw new Error("バトルモーション: 出撃前のカード位置・サイズが保存されていません")
  }
  const {
    positionElement,
    sizeElement,
    flipElement,
    selectionElement,
    motionElement
  } = getCardParts(cardElement, team, root)

  await animateOpacity(
    battleStatusElement,
    0,
    root.card_to_hand.battle_status_hide_duration_ms
  )
  restoreStatusToHandPosition(battleStatusElement)
  const liftZ = ratioToPixels(state.originalWidth, root.card_to_hand.lift_z_ratio)
  await Promise.all([
    runAnimation(
      positionElement,
      [
        { offset: 0, transform: state.finalTransform },
        {
          offset: 0.5,
          transform: `translate(${state.translateX / 2}px, ${state.translateY / 2}px) translateZ(${liftZ}px)`
        },
        { offset: 1, transform: "translate(0px, 0px) translateZ(0px)" }
      ],
      root.card_to_hand.duration_ms
    ),
    runAnimation(
      sizeElement,
      [
        { transform: sizeElement.style.transform || `scale(${state.targetScale})` },
        { transform: "scale(1)" }
      ],
      root.card_to_hand.duration_ms
    )
  ])
  positionElement.style.transform = "none"
  sizeElement.style.transform = "none"
  flipElement.style.transform = "none"
  selectionElement.style.transform = "none"
  const mobileHudElement = cardElement.querySelector?.("[data-battle-mobile-hud]") || null
  if (mobileHudElement !== null) mobileHudElement.style.transform = "none"
  motionElement.style.transform = "none"
  cardMovementStates.delete(cardElement)
  await animateOpacity(
    handStatusElement,
    1,
    root.card_to_hand.hand_status_show_duration_ms
  )
}

// 退避中の非出撃手札を表面へ戻しながら、各transform階層を元スロットへ復元する。
export const restoreHandCards = async ({ cardElements, team = null, config }) => {
  const root = validateBattleAnimationConfig(config)
  requireElements(cardElements, "復元カード")
  const restorableCards = cardElements.filter((cardElement) => cardMovementStates.has(cardElement))

  await Promise.all(restorableCards.map(async (cardElement) => {
    const cardTeam = team || cardElement.dataset?.team
    const state = cardMovementStates.get(cardElement)
    if (cardTeam !== state.team) {
      throw new Error("バトルモーション: 退避時と復元時のteamが一致しません")
    }
    const {
      positionElement,
      sizeElement,
      flipElement,
      selectionElement,
      motionElement
    } = getCardParts(cardElement, cardTeam, root)

    await Promise.all([
      runAnimation(
        positionElement,
        [
          { transform: positionElement.style.transform || `translate(${state.retreatX}px, ${state.retreatY}px)` },
          { transform: "translate(0px, 0px)" }
        ],
        root.hand_restore.duration_ms
      ),
      revealCard({ cardElement, team: cardTeam, config: root, waitForDelay: false })
    ])
    positionElement.style.transform = "none"
    sizeElement.style.transform = "none"
    flipElement.style.transform = "none"
    selectionElement.style.transform = "none"
    const mobileHudElement = cardElement.querySelector?.("[data-battle-mobile-hud]") || null
    if (mobileHudElement !== null) mobileHudElement.style.transform = "none"
    motionElement.style.transform = "none"
    cardElement.style.opacity = "1"
    cardMovementStates.delete(cardElement)
  }))
}

// リベンジ強化カードを浮かせ、YAMLの色レイヤーを重ねて元へ戻す。
export const playRevengeBuff = async ({ cardElement, team, config }) => {
  const root = validateBattleAnimationConfig(config)
  const motionElement = getMotionElement(cardElement, team, root)
  const bounds = getBounds(motionElement, "リベンジ強化カード")

  if (!cardElement.ownerDocument) {
    throw new Error("バトルモーション: リベンジ色レイヤーを作成できません")
  }

  const colorLayer = cardElement.ownerDocument.createElement("span")
  colorLayer.className = "battle-animation-revenge-color"
  colorLayer.style.backgroundColor = `rgb(${root.revenge_buff.color.r}, ${root.revenge_buff.color.g}, ${root.revenge_buff.color.b})`
  motionElement.append(colorLayer)
  const liftOffset = root.revenge_buff.lift_duration_ms / root.revenge_buff.duration_ms
  const colorPeakOffset = root.revenge_buff.color_in_duration_ms / root.revenge_buff.duration_ms
  const colorOutOffset = 1 - (root.revenge_buff.color_out_duration_ms / root.revenge_buff.duration_ms)
  const liftZ = ratioToPixels(bounds.width, root.revenge_buff.translate_z_ratio)

  try {
    await Promise.all([
      runAnimation(
        motionElement,
        [
          { offset: 0, transform: "translateZ(0px) scale(1)" },
          {
            offset: liftOffset,
            transform: `translateZ(${liftZ}px) scale(${root.revenge_buff.scale_multiplier})`
          },
          { offset: 1, transform: "translateZ(0px) scale(1)" }
        ],
        root.revenge_buff.duration_ms,
        "linear"
      ),
      runAnimation(
        colorLayer,
        [
          { offset: 0, opacity: root.revenge_buff.color_in_duration_ms === 0 ? root.revenge_buff.max_opacity_ratio : 0 },
          { offset: colorPeakOffset, opacity: root.revenge_buff.max_opacity_ratio },
          { offset: colorOutOffset, opacity: root.revenge_buff.max_opacity_ratio },
          { offset: 1, opacity: 0 }
        ],
        root.revenge_buff.duration_ms,
        "linear"
      )
    ])
  } finally {
    colorLayer.remove()
  }
}

const readDebugConfig = () => {
  const configElement = document.getElementById(CONFIG_ELEMENT_ID)

  if (configElement === null) {
    throw new Error(`バトルモーション設定JSONが見つかりません（#${CONFIG_ELEMENT_ID}）`)
  }

  let config

  try {
    config = JSON.parse(configElement.textContent)
  } catch (error) {
    throw new Error(`バトルモーション設定JSONを解析できません: ${error.message}`)
  }

  return {
    config: validateBattleAnimationConfig(config),
    cardBackUrl: requireCardBackUrl(configElement.dataset[CARD_BACK_URL_DATASET_KEY])
  }
}

const requireDebugElement = (selector, description, root = document) => {
  const element = root.querySelector(selector)

  if (element === null) {
    throw new Error(`バトルモーションデバッグ: ${description}が見つかりません（${selector}）`)
  }

  return element
}

const resetDebugCard = (cardElement) => {
  cardElement.style.visibility = "visible"
  cardElement.style.opacity = "1"
  for (const selector of [
    "[data-battle-animation-position]",
    "[data-battle-animation-size]",
    "[data-battle-animation-flip]",
    "[data-battle-animation-selection]",
    "[data-battle-animation-attack]"
  ]) {
    const element = cardElement.querySelector(selector)
    if (element !== null) element.style.transform = "none"
  }
  const frontImageUrl = cardFrontImageUrls.get(cardElement)
  if (frontImageUrl !== undefined) findCardImage(cardElement).src = frontImageUrl
  cardMovementStates.delete(cardElement)
}

const initializeBattleAnimationsDebug = () => {
  const controls = document.querySelector("[data-battle-animation-controls]")

  if (controls === null) return

  const { config, cardBackUrl } = readDebugConfig()
  const battle = requireDebugElement(".battle", "バトル画面")
  const panels = Array.from(battle.querySelectorAll(".battle__center-panel"))

  if (panels.length !== 2) {
    throw new Error(`バトルモーションデバッグ: 戦闘エリアは2個必要ですが、${panels.length}個でした`)
  }

  const enemyHand = requireDebugElement(".battle__hand--enemy", "エネミー手札", battle)
  const userHand = requireDebugElement(".battle__hand--user", "ユーザー手札", battle)
  const enemyCards = Array.from(enemyHand.querySelectorAll(".battle__hand-card"))
  const userCards = Array.from(userHand.querySelectorAll(".battle__hand-card"))

  if (enemyCards.length === 0 || userCards.length === 0) {
    throw new Error("バトルモーションデバッグ: 両チームの手札カードが必要です")
  }

  const enemyCard = enemyCards[0]
  const userCard = userCards[0]
  const enemyOtherCards = enemyCards.slice(1)
  const userOtherCards = userCards.slice(1)
  const enemyParts = ensureDebugShadow(enemyCard, "enemy", config)
  const userParts = ensureDebugShadow(userCard, "user", config)
  enemyOtherCards.forEach((card) => createMotionStructure(card, "enemy", config))
  userOtherCards.forEach((card) => createMotionStructure(card, "user", config))

  const enemyHandStatus = requireDebugElement(".battle__status-list--left", "エネミー手札ステータス", battle)
  const userHandStatus = requireDebugElement(".battle__status-list--right", "ユーザー手札ステータス", battle)
  const enemyBattleStatus = requireDebugElement("[data-battle-animation-battle-status=\"enemy\"]", "エネミー戦闘ステータス")
  const userBattleStatus = requireDebugElement("[data-battle-animation-battle-status=\"user\"]", "ユーザー戦闘ステータス")
  const startMessage = requireDebugElement("[data-battle-animation-start-message]", "バトル開始表示")
  const choiceDim = requireDebugElement("[data-battle-animation-choice-dim]", "選択暗転")
  const choicePrompt = requireDebugElement("[data-battle-animation-choice-prompt]", "選択案内")
  const overlayButton = requireDebugElement('[data-battle-effect-action="toggle-overlays"]', "選択オーバーレイ切替ボタン")
  const hpNumber = requireDebugElement("[data-battle-animation-number]", "HP数値")
  enemyBattleStatus.style.opacity = "0"
  userBattleStatus.style.opacity = "0"

  let queue = Promise.resolve()
  const enqueue = (action) => {
    queue = queue.then(action).catch((error) => {
      console.error(error)
    })
  }

  const bind = (actionName, action) => {
    requireDebugElement(`[data-battle-animation-action="${actionName}"]`, `${actionName}ボタン`, controls)
      .addEventListener("click", () => enqueue(action))
  }

  let cardChoiceVisible = false
  const showDebugCardChoice = async () => {
    await showCardChoice({ dimElement: choiceDim, promptElement: choicePrompt, config })
    cardChoiceVisible = true
    overlayButton.textContent = "オーバーレイ非表示"
  }
  const hideDebugCardChoice = () => {
    hideCardChoice({ dimElement: choiceDim, promptElement: choicePrompt })
    cardChoiceVisible = false
    overlayButton.textContent = "オーバーレイ表示"
  }

  overlayButton.addEventListener("click", () => enqueue(async () => {
    if (cardChoiceVisible) {
      hideDebugCardChoice()
      return
    }

    await showDebugCardChoice()
  }))

  const ensureMoved = async (cardElement, team) => {
    if (cardMovementStates.get(cardElement)?.deployed === true) return
    if (!cardMovementStates.has(cardElement)) await retreatAllCards()

    await moveCardToBattle({
      cardElement,
      team,
      battleAreaElement: team === "enemy" ? panels[0] : panels[1],
      handStatusElement: team === "enemy" ? enemyHandStatus : userHandStatus,
      battleStatusElement: team === "enemy" ? enemyBattleStatus : userBattleStatus,
      userReferenceCardElement: userCards[userCards.length - 1],
      config
    })
  }

  const ensureCovered = async (cardElement, team) => {
    const { imageElement } = getFrontImageUrl(cardElement)
    const resolvedCardBackUrl = new URL(cardBackUrl, document.baseURI).href

    if (imageElement.src === resolvedCardBackUrl) return
    await coverCard({ cardElement, team, cardBackUrl, config })
  }

  const retreatAllCards = () => Promise.all([
    ...enemyCards.map((card) => ensureCovered(card, "enemy")),
    ...userCards.map((card) => ensureCovered(card, "user")),
    retreatHandCards({
      cardElements: enemyCards,
      team: "enemy",
      userReferenceCardElement: userCards[userCards.length - 1],
      config
    }),
    retreatHandCards({
      cardElements: userCards,
      team: "user",
      userReferenceCardElement: userCards[userCards.length - 1],
      config
    })
  ])

  bind("entry", () => Promise.all([
    ...enemyCards.map((card) => playCardEntry({ cardElement: card, team: "enemy", config })),
    ...userCards.map((card) => playCardEntry({ cardElement: card, team: "user", config }))
  ]))
  bind("battle-start", () => playBattleStart({ messageElement: startMessage, config }))
  bind("choice", showDebugCardChoice)
  bind("select", async () => {
    await selectCard({ cardElement: userCard, otherCardElements: userOtherCards, team: "user", config })
    hideDebugCardChoice()
  })
  bind("deselect", () => deselectCard({ cardElement: userCard, otherCardElements: userOtherCards, config }))
  bind("cover", () => Promise.all([
    coverCard({ cardElement: enemyCard, team: "enemy", cardBackUrl, config }),
    coverCard({ cardElement: userCard, team: "user", cardBackUrl, config })
  ]))
  bind("retreat", retreatAllCards)
  bind("user-to-battle", () => ensureMoved(userCard, "user"))
  bind("enemy-to-battle", () => ensureMoved(enemyCard, "enemy"))
  bind("reveal", async () => {
    await Promise.all([ensureCovered(enemyCard, "enemy"), ensureCovered(userCard, "user")])
    await Promise.all([
      revealCard({ cardElement: enemyCard, team: "enemy", config }),
      revealCard({ cardElement: userCard, team: "user", config })
    ])
    await Promise.all([
      showBattleStatus({ battleStatusElement: enemyBattleStatus, config }),
      showBattleStatus({ battleStatusElement: userBattleStatus, config })
    ])
  })
  bind("user-attack", () => playAttackMotion({
    cardElement: userCard,
    shadowElement: userParts.shadowElement,
    team: "user",
    config
  }))
  bind("enemy-attack", () => playAttackMotion({
    cardElement: enemyCard,
    shadowElement: enemyParts.shadowElement,
    team: "enemy",
    config
  }))
  bind("hit", () => playHitShake({ cardElement: userCard, team: "user", config }))
  bind("damage", () => showDamageNumber({ cardElement: userCard, damage: 28, team: "user", config }))
  bind("number", async () => {
    hpNumber.textContent = "100"
    await animateNumberChange({ numberElement: hpNumber, fromValue: 100, toValue: 72, config })
  })
  bind("defeat", async () => {
    resetDebugCard(userCard)
    await fadeDefeatedCard({ cardElement: userCard, team: "user", config })
  })
  bind("to-hand", async () => {
    resetDebugCard(userCard)
    await ensureMoved(userCard, "user")
    await moveCardToHand({
      cardElement: userCard,
      team: "user",
      handStatusElement: userHandStatus,
      battleStatusElement: userBattleStatus,
      config
    })
  })
  bind("restore", () => Promise.all([
    restoreHandCards({ cardElements: enemyOtherCards, team: "enemy", config }),
    restoreHandCards({ cardElements: userOtherCards, team: "user", config })
  ]))
  bind("revenge", () => playRevengeBuff({ cardElement: userCard, team: "user", config }))
  bind("turn", async () => {
    enemyCards.forEach(resetDebugCard)
    userCards.forEach(resetDebugCard)
    await Promise.all([
      ...enemyCards.map((card) => playCardEntry({ cardElement: card, team: "enemy", config })),
      ...userCards.map((card) => playCardEntry({ cardElement: card, team: "user", config }))
    ])
    await playBattleStart({ messageElement: startMessage, config })
    await showDebugCardChoice()
    hideDebugCardChoice()
    await selectCard({ cardElement: userCard, otherCardElements: userOtherCards, team: "user", config })
    await retreatAllCards()
    await Promise.all([ensureMoved(enemyCard, "enemy"), ensureMoved(userCard, "user")])
    await Promise.all([
      revealCard({ cardElement: enemyCard, team: "enemy", config }),
      revealCard({ cardElement: userCard, team: "user", config })
    ])
    await Promise.all([
      showBattleStatus({ battleStatusElement: enemyBattleStatus, config }),
      showBattleStatus({ battleStatusElement: userBattleStatus, config })
    ])
    hpNumber.textContent = "100"
    await playAttackMotion({
      cardElement: userCard,
      shadowElement: userParts.shadowElement,
      team: "user",
      config,
      onImpact: () => Promise.all([
        playHitShake({ cardElement: enemyCard, team: "enemy", config }),
        showDamageNumber({ cardElement: enemyCard, damage: 28, team: "enemy", config }),
        animateNumberChange({ numberElement: hpNumber, fromValue: 100, toValue: 72, config })
      ])
    })
    await Promise.all([
      moveCardToHand({
        cardElement: enemyCard,
        team: "enemy",
        handStatusElement: enemyHandStatus,
        battleStatusElement: enemyBattleStatus,
        config
      }),
      moveCardToHand({
        cardElement: userCard,
        team: "user",
        handStatusElement: userHandStatus,
        battleStatusElement: userBattleStatus,
        config
      })
    ])
    await Promise.all([
      restoreHandCards({ cardElements: enemyOtherCards, team: "enemy", config }),
      restoreHandCards({ cardElements: userOtherCards, team: "user", config })
    ])
  })
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initializeBattleAnimationsDebug)
}
