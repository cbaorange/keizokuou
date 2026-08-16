import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import {
  buildAttackLiftKeyframes,
  calculateAttackLiftEasedProgress,
  calculateNumberChangeDuration,
  coverCard,
  deselectCard,
  dimCardsForChoice,
  discardStatusHandPlaceholder,
  getTeamDirection,
  hideCardChoice,
  moveCardToBattle,
  moveCardToHand,
  playAttackMotion,
  ratioToPixels,
  restoreHandCards,
  retreatHandCards,
  selectCard,
  showCardChoice,
  showBattleStatus,
  validateBattleAnimationConfig,
  validateBattleStatusConfig
} from "../../../app/javascript/battle_animation.js"

const parseScalar = (value) => {
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  return value
}

const parseSimpleYaml = (source) => {
  const root = {}
  const stack = [{ indent: -1, value: root }]

  source.split("\n").forEach((line) => {
    const withoutComment = line.replace(/\s*#.*$/, "")

    if (withoutComment.trim() === "") return

    const indent = withoutComment.match(/^\s*/)[0].length
    const match = withoutComment.trim().match(/^([a-z0-9_]+):(?:\s+(.*))?$/)

    if (match === null) {
      throw new Error(`テスト用YAMLパーサーで解釈できません: ${line}`)
    }

    while (stack[stack.length - 1].indent >= indent) stack.pop()

    const parent = stack[stack.length - 1].value
    const [, key, rawValue] = match

    if (rawValue === undefined) {
      parent[key] = {}
      stack.push({ indent, value: parent[key] })
    } else {
      parent[key] = parseScalar(rawValue)
    }
  })

  return root
}

const loadConfig = async () => parseSimpleYaml(
  await readFile(new URL("../../../config/data/battle_animations.yml", import.meta.url), "utf8")
)

const createAnimatedElement = ({ width = 100, height = 160 } = {}) => {
  const animationCalls = []
  const element = {
    style: {},
    animationCalls,
    animate(keyframes, options) {
      animationCalls.push({ keyframes, options })
      return { finished: Promise.resolve(), cancel() {}, commitStyles() {} }
    },
    getBoundingClientRect() {
      return { width, height, left: 0, top: 0 }
    }
  }

  return element
}

const createContainer = () => {
  const container = {
    children: [],
    appendChild(element) {
      element.parentElement?.children?.splice(element.parentElement.children.indexOf(element), 1)
      this.children.push(element)
      element.parentElement = this
      return element
    },
    insertBefore(element, nextSibling) {
      element.parentElement?.children?.splice(element.parentElement.children.indexOf(element), 1)
      const index = nextSibling === null ? this.children.length : this.children.indexOf(nextSibling)
      this.children.splice(index < 0 ? this.children.length : index, 0, element)
      element.parentElement = this
      return element
    },
    removeChild(element) {
      const index = this.children.indexOf(element)
      if (index >= 0) this.children.splice(index, 1)
      element.parentElement = null
      return element
    }
  }
  return container
}

const createBattleCardElement = ({
  team = "user",
  left = 0,
  top = 0,
  width = 100,
  height = 160,
  canBattle = true,
  imageUrl = "/front.PNG"
} = {}) => {
  const bounds = { left, top, width, height }
  const createPart = () => {
    const part = createAnimatedElement({ width, height })
    part.getBoundingClientRect = () => ({ ...bounds })
    return part
  }
  const parts = {
    position: createPart(),
    size: createPart(),
    orientation: createPart(),
    flip: createPart(),
    selection: createPart(),
    attack: createPart(),
    shadow: createPart(),
    mobileHud: createPart()
  }
  parts.orientation.classList = { toggle() {} }
  const image = { src: imageUrl, currentSrc: imageUrl }
  const selectors = {
    "[data-battle-animation-position]": parts.position,
    "[data-battle-animation-size]": parts.size,
    "[data-battle-animation-orientation]": parts.orientation,
    "[data-battle-animation-flip]": parts.flip,
    "[data-battle-animation-selection]": parts.selection,
    "[data-battle-animation-attack]": parts.attack,
    "[data-battle-animation-motion]": parts.attack,
    "[data-battle-animation-shadow]": parts.shadow,
    "[data-battle-mobile-hud]": parts.mobileHud,
    img: image
  }
  const card = createPart()
  card.dataset = { team, canBattle: String(canBattle) }
  card.ownerDocument = {}
  card.querySelector = (selector) => selectors[selector] || null
  return { card, parts, image, bounds }
}

test("実際のbattle_animations.ymlが必須設定を満たす", async () => {
  const config = await loadConfig()

  assert.equal(validateBattleAnimationConfig(config), config)
  assert.equal(config.attack_lift.rotation_peak_at_ratio, 0.5)
  assert.equal(config.battle_status.selected_shift_ratio, 0.2)
  assert.equal(config.battle_status.selected_shift_duration_ms, 100)
  assert.deepEqual(config.battle_status.user_background_color, { r: 66, g: 150, b: 252 })
  assert.deepEqual(config.battle_status.enemy_background_color, { r: 252, g: 66, b: 0 })
  assert.equal(Object.hasOwn(config, "hand_status_show"), false)
  assert.equal(config.card_to_battle.battle_status_show_duration_ms, 120)
  assert.equal(config.card_to_hand.hand_status_show_duration_ms, 120)
})

test("選択開始と解除で暗転兼モザイクと案内を同じ表示状態へ切り替える", async () => {
  const config = await loadConfig()
  const dimElement = createAnimatedElement()
  const promptElement = createAnimatedElement()

  await showCardChoice({ dimElement, promptElement, config })

  assert.equal(dimElement.style.visibility, "visible")
  assert.equal(promptElement.style.visibility, "visible")
  assert.equal(dimElement.style.opacity, String(config.choice_start.dim_opacity_ratio))
  assert.equal(promptElement.style.opacity, "1")

  hideCardChoice({ dimElement, promptElement })

  assert.equal(dimElement.style.visibility, "hidden")
  assert.equal(promptElement.style.visibility, "hidden")
  assert.equal(dimElement.style.opacity, "0")
  assert.equal(promptElement.style.opacity, "0")
})

test("選択画面ではエネミーカードを非選択カードと同じ濃さへ暗くする", async () => {
  const config = await loadConfig()
  const enemyCard = createBattleCardElement({ team: "enemy" })

  await dimCardsForChoice({ cardElements: [enemyCard.card], config })

  assert.equal(enemyCard.card.style.opacity, String(config.card_select.other_opacity_ratio))
  assert.equal(enemyCard.card.animationCalls.at(-1).options.duration, config.card_select.duration_ms)

  await retreatHandCards({
    cardElements: [enemyCard.card],
    team: "enemy",
    userReferenceCardElement: enemyCard.card,
    config
  })

  assert.equal(enemyCard.card.style.opacity, "1")
})

test("portraitで非描画のPC statusはopacityだけ更新しアニメーションしない", async () => {
  const config = await loadConfig()
  const hiddenStatus = createAnimatedElement()
  hiddenStatus.ownerDocument = {
    defaultView: { getComputedStyle: () => ({ display: "none" }) }
  }

  await showBattleStatus({ battleStatusElement: hiddenStatus, config })

  assert.equal(hiddenStatus.style.opacity, "1")
  assert.equal(hiddenStatus.animationCalls.length, 0)
})

test("必須親キーが不足すると明確なエラーになる", async () => {
  const config = await loadConfig()
  delete config.card_reveal

  assert.throws(
    () => validateBattleAnimationConfig(config),
    /card_revealはオブジェクトである必要があります/
  )
})

test("不正な割合を独自値で補完せずエラーにする", async () => {
  const config = await loadConfig()
  config.choice_start.dim_opacity_ratio = 1.1

  assert.throws(
    () => validateBattleAnimationConfig(config),
    /choice_start\.dim_opacity_ratioは1以下/
  )
})

test("attack_liftの減速曲線強度は数値かつ1より大きい値だけを許可する", async () => {
  const config = await loadConfig()

  config.attack_lift.deceleration_power = 1
  assert.throws(
    () => validateBattleAnimationConfig(config),
    /attack_lift\.deceleration_powerは1より大きい/
  )

  config.attack_lift.deceleration_power = "5"
  assert.throws(
    () => validateBattleAnimationConfig(config),
    /attack_lift\.deceleration_powerは数値/
  )
})

test("battle_statusの移動値とRGBを範囲どおり検証する", async () => {
  const config = await loadConfig()
  assert.equal(validateBattleStatusConfig(config.battle_status), config.battle_status)

  config.battle_status.selected_shift_duration_ms = 1.5
  assert.throws(
    () => validateBattleAnimationConfig(config),
    /selected_shift_duration_msは整数/
  )

  config.battle_status.selected_shift_duration_ms = 100
  config.battle_status.user_background_color.r = 256
  assert.throws(
    () => validateBattleAnimationConfig(config),
    /user_background_color\.rは255以下/
  )
})

test("倍率をカード寸法に対するpxへ変換する", () => {
  assert.equal(ratioToPixels(240, 0.3), 72)
  assert.equal(ratioToPixels(100, 3), 300)
})

test("持ち上げ位置は指定式で減速し、回転とscaleは従来の時間進捗を維持する", async () => {
  const config = await loadConfig()
  const frames = buildAttackLiftKeyframes({
    cardWidth: 100,
    attackLiftConfig: config.attack_lift
  })
  const startFrame = frames.find((frame) => frame.offset === 0)
  const quarterFrame = frames.find((frame) => frame.offset === 0.25)
  const peakFrame = frames.find((frame) => frame.offset === 0.5)
  const endFrame = frames.find((frame) => frame.offset === 1)
  const expectedPeakTranslateZ = 100 * calculateAttackLiftEasedProgress({
    progress: 0.5,
    decelerationPower: config.attack_lift.deceleration_power
  })
  const peakTranslateMatch = peakFrame.transform.match(/^translateZ\(([^p]+)px\)/)

  assert.equal(calculateAttackLiftEasedProgress({ progress: 0, decelerationPower: 5 }), 0)
  assert.equal(calculateAttackLiftEasedProgress({ progress: 0.5, decelerationPower: 5 }), 0.6171875)
  assert.equal(calculateAttackLiftEasedProgress({ progress: 1, decelerationPower: 5 }), 1)
  assert.equal(startFrame.transform, "translateZ(0px) rotateY(0deg) rotateZ(0deg) scale(1)")
  assert.match(quarterFrame.transform, /rotateY\(-6deg\)/)
  assert.match(quarterFrame.transform, /rotateZ\(-1\.5deg\)/)
  assert.notEqual(peakTranslateMatch, null)
  assert.equal(Number(peakTranslateMatch[1]), expectedPeakTranslateZ)
  assert.match(peakFrame.transform, /rotateY\(-12deg\)/)
  assert.match(peakFrame.transform, /rotateZ\(-3deg\)/)
  assert.match(peakFrame.transform, /scale\(1\.01\)/)
  assert.equal(
    endFrame.transform,
    "translateZ(100px) rotateY(0deg) rotateZ(0deg) scale(1.02)"
  )
})

test("ユーザーとエネミーの画面上下方向を反転する", () => {
  assert.equal(getTeamDirection("user"), 1)
  assert.equal(getTeamDirection("enemy"), -1)
  assert.throws(() => getTeamDirection("other"), /team/)
})

test("数値変動時間は0、1から19、20以上で指定どおり変化する", async () => {
  const config = await loadConfig()
  const section = config.number_change

  assert.equal(calculateNumberChangeDuration({ fromValue: 10, toValue: 10, numberChangeConfig: section }), 0)
  assert.equal(calculateNumberChangeDuration({ fromValue: 0, toValue: 10, numberChangeConfig: section }), 150)
  assert.equal(calculateNumberChangeDuration({ fromValue: 0, toValue: 19, numberChangeConfig: section }), 285)
  assert.equal(calculateNumberChangeDuration({ fromValue: 0, toValue: 20, numberChangeConfig: section }), 300)
  assert.equal(calculateNumberChangeDuration({ fromValue: 0, toValue: 80, numberChangeConfig: section }), 300)
  assert.equal(calculateNumberChangeDuration({ fromValue: 10, toValue: -10, numberChangeConfig: section }), 150)
})

test("onImpactを着地後に1回だけ開始し、返されたPromiseの完了を待つ", async () => {
  const config = await loadConfig()
  config.attack_lift.peak_hold_duration_ms = 0
  const cardElement = createAnimatedElement()
  const shadowElement = createAnimatedElement()
  let impactCount = 0
  let impactCompleted = false

  await playAttackMotion({
    cardElement,
    shadowElement,
    team: "user",
    config,
    onImpact: async () => {
      impactCount += 1
      await Promise.resolve()
      impactCompleted = true
    }
  })

  assert.equal(impactCount, 1)
  assert.equal(impactCompleted, true)
  assert.deepEqual(
    cardElement.animationCalls.map(({ options }) => options.duration),
    [config.attack_lift.duration_ms, config.attack_slam.duration_ms]
  )
})

test("lift完了後にYAMLのpeak hold時間だけ停止してからslamへ進む", async () => {
  const config = await loadConfig()
  const cardElement = createAnimatedElement()
  const shadowElement = createAnimatedElement()
  const timeoutDurations = []
  const originalSetTimeout = globalThis.setTimeout

  globalThis.setTimeout = (callback, duration) => {
    timeoutDurations.push(duration)
    queueMicrotask(callback)
    return timeoutDurations.length
  }

  try {
    await playAttackMotion({ cardElement, shadowElement, team: "user", config })
  } finally {
    globalThis.setTimeout = originalSetTimeout
  }

  assert.deepEqual(timeoutDurations, [config.attack_lift.peak_hold_duration_ms])
  assert.deepEqual(
    cardElement.animationCalls.map(({ options }) => options.duration),
    [config.attack_lift.duration_ms, config.attack_slam.duration_ms]
  )
})

test("peak hold中にAbortされた場合はslamとonImpactへ進まない", async () => {
  const config = await loadConfig()
  const cardElement = createAnimatedElement()
  const shadowElement = createAnimatedElement()
  const controller = new AbortController()
  let impactCount = 0

  const motion = playAttackMotion({
    cardElement,
    shadowElement,
    team: "user",
    config,
    signal: controller.signal,
    onImpact: () => { impactCount += 1 }
  })
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()

  await assert.rejects(motion, { name: "AbortError" })
  assert.equal(cardElement.animationCalls.length, 1)
  assert.equal(impactCount, 0)
})

test("カード選択はselection階層をY方向だけへ移動し、拡大・横移動・回転を行わない", async () => {
  const config = await loadConfig()
  const selected = createBattleCardElement()
  const other = createBattleCardElement({ left: 120 })

  await selectCard({
    cardElement: selected.card,
    otherCardElements: [other.card],
    team: "user",
    config
  })

  const selectionFrames = selected.parts.selection.animationCalls[0].keyframes
  assert.deepEqual(selectionFrames, [
    { transform: "translateY(0px)" },
    { transform: "translateY(-12.8px)" }
  ])
  assert.ok(selectionFrames.every(({ transform }) => !/scale|translateX|rotate|transform-origin/i.test(transform)))
  assert.equal(selected.card.animationCalls.length, 0)
  assert.equal(selected.parts.mobileHud.style.transform, "translateY(-12.8px)")

  await deselectCard({ cardElement: selected.card, otherCardElements: [other.card], config })
  assert.equal(selected.parts.selection.style.transform, "translateY(0px)")
  assert.equal(selected.parts.mobileHud.style.transform, "translateY(0px)")
})

test("手札退避は戦闘可能カードだけで平均Xを求め、両チームともユーザーカード高を基準に上下へ移動する", async () => {
  const config = await loadConfig()
  const userA = createBattleCardElement({ left: 0 })
  const userB = createBattleCardElement({ left: 200, canBattle: false })
  const userC = createBattleCardElement({ left: 400 })
  const enemyA = createBattleCardElement({ team: "enemy", left: 100, width: 80, height: 128 })
  const enemyB = createBattleCardElement({ team: "enemy", left: 300, width: 80, height: 128 })

  await Promise.all([
    retreatHandCards({
      cardElements: [userA.card, userB.card, userC.card],
      team: "user",
      userReferenceCardElement: userA.card,
      config
    }),
    retreatHandCards({
      cardElements: [enemyA.card, enemyB.card],
      team: "enemy",
      userReferenceCardElement: userA.card,
      config
    })
  ])

  assert.equal(userA.parts.position.style.transform, "translate(200px, 128px)")
  assert.equal(userC.parts.position.style.transform, "translate(-200px, 128px)")
  assert.equal(userB.parts.position.animationCalls.length, 0)
  assert.equal(enemyA.parts.position.style.transform, "translate(100px, -128px)")
  assert.equal(enemyB.parts.position.style.transform, "translate(-100px, -128px)")
  assert.equal(userA.parts.position.animationCalls[0].options.duration, 800)
  assert.equal(userA.card.style.opacity, "1")
  assert.ok(userA.parts.position.animationCalls[0].keyframes.every((frame) => !("opacity" in frame)))
})

test("出撃予定カードだけを画面外で戦闘エリア中心Xへ移し、敵だけ実測サイズへ瞬間変更する", async () => {
  const config = await loadConfig()
  const user = createBattleCardElement({ left: 0, top: 500 })
  const userOther = createBattleCardElement({ left: 200, top: 500 })
  const enemy = createBattleCardElement({ team: "enemy", left: 100, top: 0, width: 80, height: 128 })
  const enemyOther = createBattleCardElement({ team: "enemy", left: 300, top: 0, width: 80, height: 128 })
  const battleArea = createAnimatedElement({ width: 200, height: 240 })
  battleArea.getBoundingClientRect = () => ({ left: 400, top: 220, width: 200, height: 240 })

  await Promise.all([
    retreatHandCards({ cardElements: [user.card, userOther.card], team: "user", userReferenceCardElement: user.card, config }),
    retreatHandCards({ cardElements: [enemy.card, enemyOther.card], team: "enemy", userReferenceCardElement: user.card, config })
  ])
  const enemyOtherTransform = enemyOther.parts.position.style.transform
  await moveCardToBattle({
    cardElement: enemy.card,
    team: "enemy",
    battleAreaElement: battleArea,
    handStatusElement: null,
    battleStatusElement: null,
    userReferenceCardElement: user.card,
    config
  })

  const frames = enemy.parts.position.animationCalls.at(-1).keyframes
  assert.equal(frames[0].transform, "translate(360px, -128px) translateZ(0px)")
  const liftMatch = frames[1].transform.match(/^translate\(360px, 74px\) translateZ\(([^p]+)px\)$/)
  assert.notEqual(liftMatch, null)
  assert.ok(Math.abs(Number(liftMatch[1]) - 14.4) < Number.EPSILON * 100)
  assert.equal(frames[2].transform, "translate(360px, 276px) translateZ(0px)")
  assert.ok(frames.every((frame) => frame.transform.startsWith("translate(360px,")))
  assert.equal(enemy.parts.size.style.transform, "scale(1.25)")
  assert.equal(enemyOther.parts.position.style.transform, enemyOtherTransform)
  assert.equal(enemyOther.parts.size.style.transform, undefined)
})

test("帰還時に出撃・非出撃カードを表面と元サイズ・元位置へ戻し、orientation以外のtransformを消す", async () => {
  const config = await loadConfig()
  const selected = createBattleCardElement({ left: 0, top: 500 })
  const other = createBattleCardElement({ left: 200, top: 500 })
  const battleArea = createAnimatedElement({ width: 200, height: 240 })
  battleArea.getBoundingClientRect = () => ({ left: 400, top: 220, width: 200, height: 240 })

  await Promise.all([
    coverCard({ cardElement: selected.card, team: "user", cardBackUrl: "/back.PNG", config }),
    coverCard({ cardElement: other.card, team: "user", cardBackUrl: "/back.PNG", config }),
    retreatHandCards({ cardElements: [selected.card, other.card], team: "user", userReferenceCardElement: selected.card, config })
  ])
  await moveCardToBattle({
    cardElement: selected.card,
    team: "user",
    battleAreaElement: battleArea,
    handStatusElement: null,
    battleStatusElement: null,
    config
  })
  await Promise.all([
    moveCardToHand({ cardElement: selected.card, team: "user", handStatusElement: null, battleStatusElement: null, config }),
    restoreHandCards({ cardElements: [other.card], team: "user", config })
  ])

  for (const fixture of [selected, other]) {
    assert.equal(fixture.parts.position.style.transform, "none")
    assert.equal(fixture.parts.size.style.transform, "none")
    assert.equal(fixture.parts.flip.style.transform, "none")
    assert.equal(fixture.parts.selection.style.transform, "none")
    assert.equal(fixture.parts.attack.style.transform, "none")
  }
  assert.equal(other.image.src, "/front.PNG")
})

test("ステータスは出撃中の非表示時に戦闘位置へ移り、帰還中に同じDOMを元位置へ戻す", async () => {
  const config = await loadConfig()
  const selected = createBattleCardElement({ left: 0, top: 500 })
  const battleArea = createAnimatedElement({ width: 200, height: 240 })
  battleArea.getBoundingClientRect = () => ({ left: 400, top: 220, width: 200, height: 240 })
  const status = createAnimatedElement()
  status.dataset = { team: "user", slot: "B" }
  status.ownerDocument = {
    createElement() {
      return {
        className: "",
        dataset: {},
        attributes: {},
        parentElement: null,
        setAttribute(name, value) { this.attributes[name] = value },
        remove() { this.parentElement?.removeChild(this) }
      }
    }
  }
  const statusClasses = new Set()
  status.classList = {
    add: (value) => statusClasses.add(value),
    remove: (value) => statusClasses.delete(value),
    contains: (value) => statusClasses.has(value)
  }
  const home = createContainer()
  const marker = { parentElement: home }
  home.children.push(status, marker)
  status.parentElement = home
  status.nextSibling = marker
  const battleAnchor = createContainer()

  await retreatHandCards({
    cardElements: [selected.card],
    team: "user",
    userReferenceCardElement: selected.card,
    config
  })
  await moveCardToBattle({
    cardElement: selected.card,
    team: "user",
    battleAreaElement: battleArea,
    handStatusElement: status,
    battleStatusElement: status,
    battleStatusContainerElement: battleAnchor,
    config
  })

  assert.equal(status.parentElement, battleAnchor)
  assert.equal(status.classList.contains("battle__status-item--deployed"), true)
  assert.equal(home.children.length, 2)
  assert.equal(home.children[0].className, "battle__status-placeholder")
  assert.equal(home.children[0].dataset.team, "user")
  assert.equal(home.children[0].dataset.slot, "B")
  assert.equal(home.children[1], marker)
  assert.equal(status.style.opacity, "0")

  await showBattleStatus({ battleStatusElement: status, config })

  assert.equal(status.style.opacity, "1")
  assert.equal(
    status.animationCalls.at(-1).options.duration,
    config.card_to_battle.battle_status_show_duration_ms
  )

  await moveCardToHand({
    cardElement: selected.card,
    team: "user",
    handStatusElement: status,
    battleStatusElement: status,
    config
  })

  assert.equal(status.parentElement, home)
  assert.equal(home.children[0], status)
  assert.equal(home.children[1], marker)
  assert.equal(home.children.some((element) => element.className === "battle__status-placeholder"), false)
  assert.equal(status.classList.contains("battle__status-item--deployed"), false)
})

test("撃破確定時だけ出撃statusの予約領域を削除する", async () => {
  const config = await loadConfig()

  for (const team of ["user", "enemy"]) {
    const selected = createBattleCardElement({ team, left: 0, top: 500 })
    const battleArea = createAnimatedElement({ width: 200, height: 240 })
    battleArea.getBoundingClientRect = () => ({ left: 400, top: 220, width: 200, height: 240 })
    const status = createAnimatedElement()
    status.dataset = { team, slot: team === "user" ? "B" : "W" }
    status.ownerDocument = {
      createElement() {
        return {
          className: "",
          dataset: {},
          parentElement: null,
          setAttribute() {},
          remove() { this.parentElement?.removeChild(this) }
        }
      }
    }
    const statusClasses = new Set()
    status.classList = {
      add: (value) => statusClasses.add(value),
      remove: (value) => statusClasses.delete(value)
    }
    const home = createContainer()
    const before = { parentElement: home }
    const after = { parentElement: home }
    home.children.push(before, status, after)
    status.parentElement = home
    status.nextSibling = after
    const battleAnchor = createContainer()

    await retreatHandCards({
      cardElements: [selected.card],
      team,
      userReferenceCardElement: selected.card,
      config
    })
    await moveCardToBattle({
      cardElement: selected.card,
      team,
      battleAreaElement: battleArea,
      handStatusElement: status,
      battleStatusElement: status,
      battleStatusContainerElement: battleAnchor,
      userReferenceCardElement: selected.card,
      config
    })

    assert.equal(home.children.length, 3)
    assert.equal(home.children[1].className, "battle__status-placeholder")
    assert.equal(discardStatusHandPlaceholder(status), true)
    assert.deepEqual(home.children, [before, after])
    assert.equal(discardStatusHandPlaceholder(status), false)
  }
})
