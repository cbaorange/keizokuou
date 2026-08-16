const VALID_ATTRIBUTES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
const CONFIG_ELEMENT_ID = "battle-effects-config"
const CUT_IN_DEBUG_DATA_ELEMENT_ID = "battle-cut-in-debug-data"
const CUT_IN_TEAMS = ["user", "enemy"]

let cutInPlaying = false

const requireElement = (selector, description, root = document) => {
  const element = root.querySelector(selector)

  if (element === null) {
    throw new Error(`バトルエフェクト: ${description}が見つかりません（${selector}）`)
  }

  return element
}

const requireObject = (value, path) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`バトルエフェクト設定: ${path}はオブジェクトである必要があります`)
  }

  return value
}

const requireNumber = (value, path, { integer = false, maximum = null } = {}) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`バトルエフェクト設定: ${path}は数値である必要があります`)
  }

  if (value < 0) {
    throw new Error(`バトルエフェクト設定: ${path}は0以上である必要があります`)
  }

  if (integer && !Number.isInteger(value)) {
    throw new Error(`バトルエフェクト設定: ${path}は整数である必要があります`)
  }

  if (maximum !== null && value > maximum) {
    throw new Error(`バトルエフェクト設定: ${path}は${maximum}以下である必要があります`)
  }

  return value
}

const requirePositiveNumber = (value, path) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`バトルエフェクト設定: ${path}は0より大きい数である必要があります`)
  }
  return value
}

const requireFiniteNumber = (value, path) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`バトルエフェクト設定: ${path}は有限数である必要があります`)
  }
  return value
}

const requireText = (value, path) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`バトルエフェクト: ${path}は空でない文字列である必要があります`)
  }
  return value.trim()
}

const requireTargetElement = (targetElement) => {
  if (!(targetElement instanceof Element)) {
    throw new Error("バトルエフェクト: 対象カード要素が存在しません")
  }

  const effectLayer = targetElement.querySelector("[data-battle-effect-layer]")

  if (effectLayer === null) {
    throw new Error("バトルエフェクト: 対象カード内にエフェクトレイヤーがありません")
  }

  const width = effectLayer.getBoundingClientRect().width
  const height = effectLayer.getBoundingClientRect().height

  if (width <= 0 || height <= 0) {
    throw new Error("バトルエフェクト: 対象カードの表示サイズを取得できません")
  }

  return { effectLayer, width, height }
}

const requireDefeatEffectLayer = (effectLayer) => {
  if (!(effectLayer instanceof Element) || !effectLayer.hasAttribute("data-battle-defeat-effect-layer")) {
    throw new Error("バトルエフェクト: 戦闘エリア用の撃破エフェクトレイヤーが存在しません")
  }
  const { width, height } = effectLayer.getBoundingClientRect()
  if (width <= 0 || height <= 0) {
    throw new Error("バトルエフェクト: 撃破エフェクトレイヤーの表示サイズを取得できません")
  }

  return { effectLayer, width, height }
}

const requireColor = (value, path) => {
  const color = requireObject(value, path)

  return {
    r: requireNumber(color.r, `${path}.r`, { maximum: 255 }),
    g: requireNumber(color.g, `${path}.g`, { maximum: 255 }),
    b: requireNumber(color.b, `${path}.b`, { maximum: 255 })
  }
}

const readBattleEffectsConfig = () => {
  const configElement = document.getElementById(CONFIG_ELEMENT_ID)

  if (configElement === null) {
    throw new Error(`バトルエフェクト設定JSONが見つかりません（#${CONFIG_ELEMENT_ID}）`)
  }

  try {
    return requireObject(JSON.parse(configElement.textContent), "root")
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`バトルエフェクト設定JSONを解析できません: ${error.message}`)
    }

    throw error
  }
}

const readJsonElement = (elementId, description) => {
  const element = document.getElementById(elementId)
  if (element === null) {
    throw new Error(`${description}JSONが見つかりません（#${elementId}）`)
  }
  try {
    return requireObject(JSON.parse(element.textContent), description)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${description}JSONを解析できません: ${error.message}`)
    }
    throw error
  }
}

const readRingBase = (config) => {
  const ringBase = requireObject(config.ring_base, "ring_base")

  return {
    borderWidthRatio: requireNumber(
      ringBase.border_width_ratio,
      "ring_base.border_width_ratio"
    ),
    startOpacityRatio: requireNumber(
      ringBase.start_opacity_ratio,
      "ring_base.start_opacity_ratio",
      { maximum: 1 }
    ),
    endOpacityRatio: requireNumber(
      ringBase.end_opacity_ratio,
      "ring_base.end_opacity_ratio",
      { maximum: 1 }
    )
  }
}

const createRing = ({
  effectLayer,
  x,
  y,
  color,
  borderWidth,
  initialSize
}) => {
  const ring = document.createElement("span")
  ring.className = "battle-effect-ring"
  ring.setAttribute("aria-hidden", "true")
  ring.style.left = `${x}px`
  ring.style.top = `${y}px`
  ring.style.width = `${initialSize}px`
  ring.style.height = `${initialSize}px`
  ring.style.borderWidth = `${borderWidth}px`
  ring.style.borderColor = `rgb(${color.r}, ${color.g}, ${color.b})`
  effectLayer.append(ring)

  return ring
}

const animateRing = async ({
  ring,
  initialSize,
  scaleMultiplier,
  durationMs,
  startOpacityRatio,
  endOpacityRatio
}) => {
  const finalSize = initialSize * scaleMultiplier
  const animation = ring.animate(
    [
      {
        width: `${initialSize}px`,
        height: `${initialSize}px`,
        opacity: startOpacityRatio
      },
      {
        width: `${finalSize}px`,
        height: `${finalSize}px`,
        opacity: endOpacityRatio
      }
    ],
    {
      duration: durationMs,
      easing: "ease-out",
      fill: "forwards"
    }
  )

  try {
    await animation.finished
  } finally {
    ring.remove()
  }
}

const playRing = ({
  effectLayer,
  x,
  y,
  color,
  borderWidth,
  initialSize,
  scaleMultiplier,
  durationMs,
  startOpacityRatio,
  endOpacityRatio
}) => {
  const ring = createRing({
    effectLayer,
    x,
    y,
    color,
    borderWidth,
    initialSize
  })

  return animateRing({
    ring,
    initialSize,
    scaleMultiplier,
    durationMs,
    startOpacityRatio,
    endOpacityRatio
  })
}

const wait = (durationMs) => new Promise((resolve) => {
  window.setTimeout(resolve, durationMs)
})

const createAbortError = () => {
  const error = new Error("カットインが中断されました")
  error.name = "AbortError"
  return error
}

const throwIfAborted = (signal) => {
  if (signal?.aborted) throw createAbortError()
}

const waitForCutInDuration = (durationMs, { signal, windowRef }) => new Promise((resolve, reject) => {
  throwIfAborted(signal)
  let onAbort = null
  const timeoutId = windowRef.setTimeout(() => {
    if (onAbort !== null) signal?.removeEventListener("abort", onAbort)
    resolve()
  }, durationMs)
  onAbort = () => {
    windowRef.clearTimeout(timeoutId)
    signal.removeEventListener("abort", onAbort)
    reject(createAbortError())
  }
  signal?.addEventListener("abort", onAbort, { once: true })
})

const applyFinalKeyframe = (element, keyframe) => {
  for (const [property, value] of Object.entries(keyframe)) {
    if (property === "offset") continue
    element.style[property] = String(value)
  }
}

const runCutInAnimation = async (element, keyframes, options, signal) => {
  throwIfAborted(signal)
  const animation = element.animate(keyframes, options)
  let onAbort = null
  const abortPromise = signal === null || signal === undefined
    ? null
    : new Promise((resolve, reject) => {
        onAbort = () => reject(createAbortError())
        signal.addEventListener("abort", onAbort, { once: true })
      })

  try {
    if (abortPromise === null) {
      await animation.finished
    } else {
      await Promise.race([animation.finished, abortPromise])
    }
    applyFinalKeyframe(element, keyframes[keyframes.length - 1])
  } finally {
    if (onAbort !== null) signal.removeEventListener("abort", onAbort)
    animation.cancel()
  }
}

const readCutInConfig = (config) => {
  const cutIn = requireObject(requireObject(config, "root").cut_in, "cut_in")
  const overlay = requireObject(cutIn.overlay, "cut_in.overlay")
  const text = requireObject(cutIn.text, "cut_in.text")
  const gradient = requireObject(cutIn.gradient, "cut_in.gradient")
  const verticalCenterRatio = requireNumber(
    cutIn.vertical_center_ratio,
    "cut_in.vertical_center_ratio",
    { maximum: 1 }
  )
  const gradientEndRatio = requireNumber(
    gradient.end_ratio,
    "cut_in.gradient.end_ratio",
    { maximum: 0.5 }
  )
  const fontWeight = requireNumber(text.font_weight, "cut_in.text.font_weight", { integer: true })

  return {
    rectangleHeightRem: requirePositiveNumber(cutIn.rectangle_height_rem, "cut_in.rectangle_height_rem"),
    rotationDeg: requireFiniteNumber(cutIn.rotation_deg, "cut_in.rotation_deg"),
    verticalCenterRatio,
    portraitHeightRatio: requirePositiveNumber(cutIn.portrait_height_ratio, "cut_in.portrait_height_ratio"),
    contentMoveRem: requireNumber(cutIn.content_move_rem, "cut_in.content_move_rem"),
    lengthChangeDurationMs: requireNumber(
      cutIn.length_change_duration_ms,
      "cut_in.length_change_duration_ms",
      { integer: true }
    ),
    maxLengthHoldDurationMs: requireNumber(
      cutIn.max_length_hold_duration_ms,
      "cut_in.max_length_hold_duration_ms",
      { integer: true }
    ),
    lengthOverscanRatio: requirePositiveNumber(cutIn.length_overscan_ratio, "cut_in.length_overscan_ratio"),
    overlayRgb: requireNumber(overlay.rgb, "cut_in.overlay.rgb", { maximum: 255 }),
    overlayAlpha: requireNumber(overlay.alpha, "cut_in.overlay.alpha", { maximum: 1 }),
    fontSizeRem: requirePositiveNumber(text.font_size_rem, "cut_in.text.font_size_rem"),
    fontWeight,
    shadowOffsetXPx: requireNumber(text.hadow_offset_x_px, "cut_in.text.hadow_offset_x_px"),
    shadowOffsetYPx: requireNumber(text.shadow_offset_y_px, "cut_in.text.shadow_offset_y_px"),
    shadowOpacityRatio: requireNumber(
      text.shadow_opacity_ratio,
      "cut_in.text.shadow_opacity_ratio",
      { maximum: 1 }
    ),
    gradientEndRatio,
    userColors: {
      edge: requireColor(requireObject(cutIn.user_advantage, "cut_in.user_advantage").edge_color, "cut_in.user_advantage.edge_color"),
      center: requireColor(cutIn.user_advantage.center_color, "cut_in.user_advantage.center_color")
    },
    enemyColors: {
      edge: requireColor(requireObject(cutIn.enemy_advantage, "cut_in.enemy_advantage").edge_color, "cut_in.enemy_advantage.edge_color"),
      center: requireColor(cutIn.enemy_advantage.center_color, "cut_in.enemy_advantage.center_color")
    }
  }
}

const rgb = (color) => `rgb(${color.r}, ${color.g}, ${color.b})`

const responsiveCutInRemValue = ({ documentRef, windowRef, propertyName, fallback }) => {
  const battleElement = typeof documentRef.querySelector === "function"
    ? documentRef.querySelector(".battle")
    : null
  if (battleElement === null || typeof windowRef.getComputedStyle !== "function") return fallback

  const rawValue = windowRef.getComputedStyle(battleElement).getPropertyValue(propertyName).trim()
  if (rawValue === "") return fallback
  const match = rawValue.match(/^([0-9]+(?:\.[0-9]+)?)rem$/)
  if (match === null) {
    throw new Error(`バトルエフェクト: ${propertyName}はrem値である必要があります`)
  }
  return requirePositiveNumber(Number(match[1]), propertyName)
}

const createCutInElements = ({
  team,
  text,
  portraitUrl,
  settings,
  documentRef,
  windowRef
}) => {
  if (!CUT_IN_TEAMS.includes(team)) {
    throw new Error(`バトルエフェクト: カットインチーム「${team}」は不正です`)
  }
  if (documentRef?.body === undefined || typeof documentRef.createElement !== "function") {
    throw new Error("バトルエフェクト: カットインを追加するdocumentが不正です")
  }
  const viewportWidth = requirePositiveNumber(windowRef.innerWidth, "viewport.innerWidth")
  const viewportHeight = requirePositiveNumber(windowRef.innerHeight, "viewport.innerHeight")
  const rectangleHeightRem = responsiveCutInRemValue({
    documentRef,
    windowRef,
    propertyName: "--battle-responsive-cut-in-rectangle-height",
    fallback: settings.rectangleHeightRem
  })
  const fontSizeRem = responsiveCutInRemValue({
    documentRef,
    windowRef,
    propertyName: "--battle-responsive-cut-in-text-font-size",
    fallback: settings.fontSizeRem
  })
  // length_overscan_ratioは追加割合ではなく、画面対角線へ直接掛ける倍率。
  const maxLengthPx = Math.hypot(viewportWidth, viewportHeight) * settings.lengthOverscanRatio
  const colors = team === "user" ? settings.userColors : settings.enemyColors
  const gradientEndPercent = settings.gradientEndRatio * 100
  const gradientStartPercent = 100 - gradientEndPercent

  const layer = documentRef.createElement("div")
  layer.className = "battle-cut-in-layer"
  layer.setAttribute("data-battle-cut-in-layer", "")
  layer.setAttribute("aria-hidden", "true")

  const overlay = documentRef.createElement("div")
  overlay.className = "battle-cut-in-layer__overlay"
  overlay.style.backgroundColor = `rgba(${settings.overlayRgb}, ${settings.overlayRgb}, ${settings.overlayRgb}, ${settings.overlayAlpha})`

  const rectangle = documentRef.createElement("div")
  rectangle.className = `battle-cut-in battle-cut-in--${team}`
  rectangle.style.width = `${maxLengthPx}px`
  rectangle.style.height = `${rectangleHeightRem}rem`
  rectangle.style.top = `${viewportHeight * settings.verticalCenterRatio}px`
  rectangle.style.transform = `translate(-50%, -50%) rotate(${settings.rotationDeg}deg)`
  rectangle.style.background = `linear-gradient(to bottom, ${rgb(colors.edge)} 0%, ${rgb(colors.center)} ${gradientEndPercent}%, ${rgb(colors.center)} ${gradientStartPercent}%, ${rgb(colors.edge)} 100%)`

  const content = documentRef.createElement("div")
  content.className = "battle-cut-in__content"

  const textElement = documentRef.createElement("span")
  textElement.className = "battle-cut-in__text"
  textElement.textContent = requireText(text, "表示文字")
  textElement.style.fontSize = `${fontSizeRem}rem`
  textElement.style.fontWeight = String(settings.fontWeight)
  textElement.style.textShadow = `${settings.shadowOffsetXPx}px ${settings.shadowOffsetYPx}px 0 color-mix(in srgb, var(--gray-1) ${settings.shadowOpacityRatio * 100}%, transparent)`
  content.append(textElement)

  if (portraitUrl !== null && portraitUrl !== undefined) {
    const portrait = documentRef.createElement("img")
    portrait.className = "battle-cut-in__portrait"
    portrait.src = requireText(portraitUrl, "ポートレートURL")
    portrait.alt = ""
    portrait.style.height = `${rectangleHeightRem * settings.portraitHeightRatio}rem`
    content.append(portrait)
  }

  rectangle.append(content)
  layer.append(overlay, rectangle)
  documentRef.body.append(layer)

  return { layer, overlay, rectangle, content, maxLengthPx }
}

// 暗転、長方形と内容の移動、暗転解除、DOM削除までを1回の呼び出しで完了する
export const playBattleCutIn = async ({
  team,
  text,
  portraitUrl = null,
  config,
  signal = null,
  documentRef = document,
  windowRef = window
}) => {
  if (cutInPlaying) {
    throw new Error("バトルエフェクト: カットインは既に再生中です")
  }
  cutInPlaying = true
  let elements = null

  try {
    const settings = readCutInConfig(config)
    elements = createCutInElements({ team, text, portraitUrl, settings, documentRef, windowRef })
    const totalDurationMs = (settings.lengthChangeDurationMs * 2) + settings.maxLengthHoldDurationMs
    const halfMoveRem = settings.contentMoveRem / 2
    const contentAnimation = runCutInAnimation(elements.content, [
      { transform: `translateX(${halfMoveRem}rem)`, offset: 0 },
      { transform: "translateX(0rem)", offset: 0.5 },
      { transform: `translateX(-${halfMoveRem}rem)`, offset: 1 }
    ], {
      duration: totalDurationMs,
      easing: "linear",
      fill: "forwards"
    }, signal)
    // hold中に中断されても、並行中の内容アニメーションの拒否を未処理にしない。
    void contentAnimation.catch(() => {})

    await Promise.all([
      runCutInAnimation(elements.rectangle, [
        { clipPath: "inset(0 0 0 100%)" },
        { clipPath: "inset(0 0 0 0%)" }
      ], {
        duration: settings.lengthChangeDurationMs,
        easing: "linear",
        fill: "forwards"
      }, signal),
      runCutInAnimation(elements.overlay, [
        { opacity: 0 },
        { opacity: 1 }
      ], {
        duration: settings.lengthChangeDurationMs,
        easing: "linear",
        fill: "forwards"
      }, signal)
    ])

    await waitForCutInDuration(settings.maxLengthHoldDurationMs, { signal, windowRef })
    await Promise.all([
      runCutInAnimation(elements.rectangle, [
        { clipPath: "inset(0 0% 0 0)" },
        { clipPath: "inset(0 100% 0 0)" }
      ], {
        duration: settings.lengthChangeDurationMs,
        easing: "linear",
        fill: "forwards"
      }, signal),
      runCutInAnimation(elements.overlay, [
        { opacity: 1 },
        { opacity: 0 }
      ], {
        duration: settings.lengthChangeDurationMs,
        easing: "linear",
        fill: "forwards"
      }, signal),
      contentAnimation
    ])
  } finally {
    elements?.layer.remove()
    cutInPlaying = false
  }
}

export const playHitEffect = async (targetElement, attribute, config) => {
  if (!VALID_ATTRIBUTES.includes(attribute)) {
    throw new Error(
      `バトルエフェクト: 属性「${attribute}」は不正です。${VALID_ATTRIBUTES.join(", ")}のいずれかを指定してください`
    )
  }

  const { effectLayer, width, height } = requireTargetElement(targetElement)
  const ringBase = readRingBase(requireObject(config, "root"))
  const hitEffect = requireObject(config.hit_effect, "hit_effect")
  const attributeColors = requireObject(
    hitEffect.attribute_colors,
    "hit_effect.attribute_colors"
  )
  const color = requireColor(
    attributeColors[attribute],
    `hit_effect.attribute_colors.${attribute}`
  )
  const randomRings = requireObject(
    hitEffect.random_rings,
    "hit_effect.random_rings"
  )
  const centerRing = requireObject(
    hitEffect.center_ring,
    "hit_effect.center_ring"
  )
  const count = requireNumber(
    randomRings.count,
    "hit_effect.random_rings.count",
    { integer: true }
  )
  const initialSize = width * requireNumber(
    randomRings.initial_size_ratio,
    "hit_effect.random_rings.initial_size_ratio"
  )
  const randomDurationMs = requireNumber(
    randomRings.duration_ms,
    "hit_effect.random_rings.duration_ms"
  )
  const randomNextSpawnAtRatio = requireNumber(
    randomRings.next_spawn_at_ratio,
    "hit_effect.random_rings.next_spawn_at_ratio",
    { maximum: 1 }
  )
  const randomScaleMultiplier = requireNumber(
    randomRings.scale_multiplier,
    "hit_effect.random_rings.scale_multiplier"
  )
  const centerInitialSize = initialSize * requireNumber(
    centerRing.initial_size_multiplier,
    "hit_effect.center_ring.initial_size_multiplier"
  )
  const centerDurationMs = requireNumber(
    centerRing.duration_ms,
    "hit_effect.center_ring.duration_ms"
  )
  const centerNextSpawnAtRatio = requireNumber(
    centerRing.next_spawn_at_ratio,
    "hit_effect.center_ring.next_spawn_at_ratio",
    { maximum: 1 }
  )
  const centerScaleMultiplier = requireNumber(
    centerRing.scale_multiplier,
    "hit_effect.center_ring.scale_multiplier"
  )
  const borderWidth = width * ringBase.borderWidthRatio
  const randomNextSpawnDelayMs = randomDurationMs * randomNextSpawnAtRatio
  const centerNextSpawnDelayMs = randomDurationMs * centerNextSpawnAtRatio
  const animations = []

  for (let index = 0; index < count; index += 1) {
    animations.push(playRing({
      effectLayer,
      x: Math.random() * width,
      y: Math.random() * height,
      color,
      borderWidth,
      initialSize,
      scaleMultiplier: randomScaleMultiplier,
      durationMs: randomDurationMs,
      startOpacityRatio: ringBase.startOpacityRatio,
      endOpacityRatio: ringBase.endOpacityRatio
    }))

    if (index < count - 1) {
      await wait(randomNextSpawnDelayMs)
    }
  }

  if (count > 0) {
    await wait(centerNextSpawnDelayMs)
  }

  animations.push(playRing({
    effectLayer,
    x: width / 2,
    y: height / 2,
    color,
    borderWidth,
    initialSize: centerInitialSize,
    scaleMultiplier: centerScaleMultiplier,
    durationMs: centerDurationMs,
    startOpacityRatio: ringBase.startOpacityRatio,
    endOpacityRatio: ringBase.endOpacityRatio
  }))

  await Promise.all(animations)
}

export const playDefeatEffect = async (effectLayerElement, config) => {
  const { effectLayer, width, height } = requireDefeatEffectLayer(effectLayerElement)
  const ringBase = readRingBase(requireObject(config, "root"))
  const defeatEffect = requireObject(config.defeat_effect, "defeat_effect")
  const rings = requireObject(defeatEffect.rings, "defeat_effect.rings")
  const normalDefeat = requireObject(
    defeatEffect.normal_defeat,
    "defeat_effect.normal_defeat"
  )
  const color = requireColor(defeatEffect.color, "defeat_effect.color")
  const count = requireNumber(
    normalDefeat.count,
    "defeat_effect.normal_defeat.count",
    { integer: true }
  )
  const initialSize = width * requireNumber(
    rings.initial_size_ratio,
    "defeat_effect.rings.initial_size_ratio"
  )
  const durationMs = requireNumber(
    rings.duration_ms,
    "defeat_effect.rings.duration_ms"
  )
  const scaleMultiplier = requireNumber(
    rings.scale_multiplier,
    "defeat_effect.rings.scale_multiplier"
  )
  const nextSpawnAtRatio = requireNumber(
    rings.next_spawn_at_ratio,
    "defeat_effect.rings.next_spawn_at_ratio",
    { maximum: 1 }
  )
  const borderWidth = width * ringBase.borderWidthRatio
  const nextSpawnDelayMs = durationMs * nextSpawnAtRatio
  const animations = []

  for (let index = 0; index < count; index += 1) {
    animations.push(playRing({
      effectLayer,
      x: Math.random() * width,
      y: Math.random() * height,
      color,
      borderWidth,
      initialSize,
      scaleMultiplier,
      durationMs,
      startOpacityRatio: ringBase.startOpacityRatio,
      endOpacityRatio: ringBase.endOpacityRatio
    }))

    if (index < count - 1) {
      await wait(nextSpawnDelayMs)
    }
  }

  await Promise.all(animations)
}

const placeDebugCard = (card, panel, battle) => {
  const panelBounds = panel.getBoundingClientRect()
  const battleBounds = battle.getBoundingClientRect()
  card.style.left = `${panelBounds.left - battleBounds.left + (panelBounds.width / 2)}px`
  card.style.top = `${panelBounds.top - battleBounds.top + (panelBounds.height / 2)}px`
}

const placeDefeatEffectLayer = (effectLayer, panel, battle) => {
  const panelBounds = panel.getBoundingClientRect()
  const battleBounds = battle.getBoundingClientRect()
  effectLayer.style.left = `${panelBounds.left - battleBounds.left}px`
  effectLayer.style.top = `${panelBounds.top - battleBounds.top}px`
  effectLayer.style.width = `${panelBounds.width}px`
  effectLayer.style.height = `${panelBounds.height}px`
}

const initializeBattleEffectsDebug = () => {
  const config = readBattleEffectsConfig()
  const cutInDebugData = readJsonElement(CUT_IN_DEBUG_DATA_ELEMENT_ID, "カットインデバッグデータ")
  const battle = requireElement(".battle", "バトル画面")
  const panels = Array.from(document.querySelectorAll(".battle__center-panel"))

  if (panels.length !== 2) {
    throw new Error(
      `バトルエフェクト: 戦闘エリアは2個必要ですが、${panels.length}個でした`
    )
  }

  const enemyCard = requireElement(
    '[data-battle-effect-target="enemy"]',
    "エネミー側カード"
  )
  const userCard = requireElement(
    '[data-battle-effect-target="user"]',
    "ユーザー側カード"
  )
  const enemyDefeatEffectLayer = requireElement(
    '[data-battle-defeat-effect-layer][data-team="enemy"]',
    "エネミー撃破エフェクトレイヤー"
  )
  const userDefeatEffectLayer = requireElement(
    '[data-battle-defeat-effect-layer][data-team="user"]',
    "ユーザー撃破エフェクトレイヤー"
  )
  const attributeSelect = requireElement(
    "[data-battle-effect-attribute]",
    "属性選択"
  )
  battle.append(enemyCard, userCard)

  const placeCards = () => {
    placeDebugCard(enemyCard, panels[0], battle)
    placeDebugCard(userCard, panels[1], battle)
    placeDefeatEffectLayer(enemyDefeatEffectLayer, panels[0], battle)
    placeDefeatEffectLayer(userDefeatEffectLayer, panels[1], battle)
  }

  placeCards()
  window.addEventListener("resize", placeCards)

  const runEffect = (effect) => {
    effect.catch((error) => {
      console.error(error)
    })
  }

  requireElement('[data-battle-effect-action="hit-user"]', "ユーザーヒットボタン")
    .addEventListener("click", () => {
      runEffect(playHitEffect(userCard, attributeSelect.value, config))
    })
  requireElement('[data-battle-effect-action="hit-enemy"]', "エネミーヒットボタン")
    .addEventListener("click", () => {
      runEffect(playHitEffect(enemyCard, attributeSelect.value, config))
    })
  requireElement('[data-battle-effect-action="defeat-user"]', "ユーザー撃破ボタン")
    .addEventListener("click", () => {
      runEffect(playDefeatEffect(userDefeatEffectLayer, config))
    })
  requireElement('[data-battle-effect-action="defeat-enemy"]', "エネミー撃破ボタン")
    .addEventListener("click", () => {
      runEffect(playDefeatEffect(enemyDefeatEffectLayer, config))
    })

  const cutInButtons = Array.from(document.querySelectorAll("[data-battle-cut-in-action]"))
  if (cutInButtons.length !== 6) {
    throw new Error(`バトルエフェクト: カットイン確認ボタンは6個必要ですが、${cutInButtons.length}個でした`)
  }
  const cutInText = requireObject(requireObject(config.cut_in, "cut_in").text, "cut_in.text")
  const cutInDefinitions = {
    "user-advantage": { team: "user", text: cutInText.user_advantage, portraitUrl: null },
    "enemy-advantage": { team: "enemy", text: cutInText.enemy_advantage, portraitUrl: null },
    "user-normal-defeat": { team: "user", text: cutInDebugData.normalDefeat, portraitUrl: cutInDebugData.portraitUrl },
    "enemy-normal-defeat": { team: "enemy", text: cutInDebugData.normalDefeat, portraitUrl: cutInDebugData.portraitUrl },
    "user-final-defeat": { team: "user", text: cutInDebugData.finalDefeat, portraitUrl: cutInDebugData.portraitUrl },
    "enemy-final-defeat": { team: "enemy", text: cutInDebugData.finalDefeat, portraitUrl: cutInDebugData.portraitUrl }
  }
  const runCutIn = async (definition) => {
    cutInButtons.forEach((button) => { button.disabled = true })
    try {
      await playBattleCutIn({ ...definition, config })
    } finally {
      cutInButtons.forEach((button) => { button.disabled = false })
    }
  }
  cutInButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const definition = cutInDefinitions[button.dataset.battleCutInAction]
      if (definition === undefined) {
        console.error(new Error(`バトルエフェクト: 未定義のカットイン操作です: ${button.dataset.battleCutInAction}`))
        return
      }
      runEffect(runCutIn(definition))
    })
  })

}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    if (document.querySelector(".battle-debug-controls") === null) return

    initializeBattleEffectsDebug()
  })
}
