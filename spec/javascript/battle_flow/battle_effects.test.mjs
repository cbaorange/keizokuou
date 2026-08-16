import test from "node:test"
import assert from "node:assert/strict"

class FakeElement {
  constructor({ width = 0, height = 0, attributes = {} } = {}) {
    this.width = width
    this.height = height
    this.attributes = { ...attributes }
    this.children = []
    this.style = {}
  }

  hasAttribute(name) {
    return Object.hasOwn(this.attributes, name)
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
  }

  getBoundingClientRect() {
    return { width: this.width, height: this.height, left: 0, top: 0 }
  }

  append(child) {
    child.parent = this
    this.children.push(child)
  }

  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this)
  }
}

test("撃破エフェクトは戦闘エリア幅と内部座標を使い、最後の円まで待ってDOMを全削除する", async () => {
  const animationResolvers = []
  globalThis.Element = FakeElement
  globalThis.window = { setTimeout: (callback) => { callback(); return 0 } }
  globalThis.document = {
    addEventListener() {},
    createElement() {
      const ring = new FakeElement()
      ring.animate = () => ({
        finished: new Promise((resolve) => animationResolvers.push(resolve))
      })
      return ring
    }
  }
  const { playDefeatEffect } = await import("../../../app/javascript/battle_effects.js")
  const effectLayer = new FakeElement({
    width: 200,
    height: 100,
    attributes: { "data-battle-defeat-effect-layer": "" }
  })
  const config = {
    ring_base: {
      border_width_ratio: 0.05,
      start_opacity_ratio: 1,
      end_opacity_ratio: 0
    },
    defeat_effect: {
      color: { r: 240, g: 240, b: 240 },
      rings: {
        initial_size_ratio: 0.2,
        duration_ms: 300,
        scale_multiplier: 2,
        next_spawn_at_ratio: 0
      },
      normal_defeat: { count: 3 }
    }
  }
  const originalRandom = Math.random
  const randomValues = [0, 0, 0.5, 0.5, 1, 1]
  Math.random = () => randomValues.shift()

  try {
    let completed = false
    const effect = playDefeatEffect(effectLayer, config).then(() => { completed = true })
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(effectLayer.children.length, 3)
    assert.deepEqual(effectLayer.children.map((ring) => [ring.style.left, ring.style.top]), [
      ["0px", "0px"],
      ["100px", "50px"],
      ["200px", "100px"]
    ])
    assert.ok(effectLayer.children.every((ring) => ring.style.width === "40px"))
    assert.ok(effectLayer.children.every((ring) => ring.style.borderWidth === "10px"))

    animationResolvers[0]()
    animationResolvers[1]()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(completed, false)
    assert.equal(effectLayer.children.length, 1)

    animationResolvers[2]()
    await effect
    assert.equal(completed, true)
    assert.equal(effectLayer.children.length, 0)
  } finally {
    Math.random = originalRandom
  }
})

test("カットインは対角線への直接倍率、中央通過、右から左の出現消滅を使いDOMを削除する", async () => {
  const animations = []
  const createdElements = []
  const body = new FakeElement()
  const documentRef = {
    body,
    createElement(tagName) {
      const element = new FakeElement()
      element.tagName = tagName
      element.animate = (keyframes, options) => {
        animations.push({ element, keyframes, options })
        return { finished: Promise.resolve(), cancel() {} }
      }
      createdElements.push(element)
      return element
    }
  }
  const windowRef = {
    innerWidth: 300,
    innerHeight: 400,
    setTimeout(callback) {
      const id = setTimeout(callback, 0)
      return id
    },
    clearTimeout
  }
  const config = {
    cut_in: {
      rectangle_height_rem: 7,
      rotation_deg: 10,
      vertical_center_ratio: 0.5,
      portrait_height_ratio: 1,
      content_move_rem: 4,
      length_change_duration_ms: 200,
      max_length_hold_duration_ms: 1000,
      length_overscan_ratio: 1.2,
      overlay: { rgb: 5, alpha: 0.3 },
      text: {
        font_size_rem: 4,
        font_weight: 700,
        hadow_offset_x_px: 2,
        shadow_offset_y_px: 4,
        shadow_opacity_ratio: 0.7
      },
      gradient: { end_ratio: 0.2 },
      user_advantage: {
        edge_color: { r: 1, g: 2, b: 3 },
        center_color: { r: 4, g: 5, b: 6 }
      },
      enemy_advantage: {
        edge_color: { r: 7, g: 8, b: 9 },
        center_color: { r: 10, g: 11, b: 12 }
      }
    }
  }
  const { playBattleCutIn } = await import("../../../app/javascript/battle_effects.js")

  await playBattleCutIn({
    team: "user",
    text: "決着です！",
    portraitUrl: "/portrait.PNG",
    config,
    documentRef,
    windowRef
  })

  const rectangle = createdElements.find((element) => element.className === "battle-cut-in battle-cut-in--user")
  const content = createdElements.find((element) => element.className === "battle-cut-in__content")
  const textElement = createdElements.find((element) => element.className === "battle-cut-in__text")
  const portrait = createdElements.find((element) => element.className === "battle-cut-in__portrait")
  const overlay = createdElements.find((element) => element.className === "battle-cut-in-layer__overlay")
  assert.equal(rectangle.style.width, "600px")
  assert.equal(rectangle.style.top, "200px")
  assert.equal(rectangle.style.transform, "translate(-50%, -50%) rotate(10deg)")
  assert.equal(
    rectangle.style.background,
    "linear-gradient(to bottom, rgb(1, 2, 3) 0%, rgb(4, 5, 6) 20%, rgb(4, 5, 6) 80%, rgb(1, 2, 3) 100%)"
  )
  assert.equal(portrait.style.height, "7rem")
  assert.equal(portrait.style.marginTop, undefined)
  assert.equal(
    textElement.style.textShadow,
    "2px 4px 0 color-mix(in srgb, var(--gray-1) 70%, transparent)"
  )
  assert.equal(overlay.style.backgroundColor, "rgba(5, 5, 5, 0.3)")

  const contentAnimation = animations.find((animation) => animation.element === content)
  assert.equal(contentAnimation.options.duration, 1400)
  assert.deepEqual(contentAnimation.keyframes, [
    { transform: "translateX(2rem)", offset: 0 },
    { transform: "translateX(0rem)", offset: 0.5 },
    { transform: "translateX(-2rem)", offset: 1 }
  ])
  const rectangleAnimations = animations.filter((animation) => animation.element === rectangle)
  assert.deepEqual(rectangleAnimations[0].keyframes, [
    { clipPath: "inset(0 0 0 100%)" },
    { clipPath: "inset(0 0 0 0%)" }
  ])
  assert.deepEqual(rectangleAnimations[1].keyframes, [
    { clipPath: "inset(0 0% 0 0)" },
    { clipPath: "inset(0 100% 0 0)" }
  ])
  assert.equal(body.children.length, 0)

  const battleElement = new FakeElement()
  documentRef.querySelector = (selector) => selector === ".battle" ? battleElement : null
  windowRef.getComputedStyle = () => ({
    getPropertyValue(propertyName) {
      return {
        "--battle-responsive-cut-in-rectangle-height": "5rem",
        "--battle-responsive-cut-in-text-font-size": "2.5rem"
      }[propertyName] ?? ""
    }
  })
  await playBattleCutIn({
    team: "enemy",
    text: "モバイル",
    portraitUrl: null,
    config,
    documentRef,
    windowRef
  })

  const mobileRectangle = createdElements
    .filter((element) => element.className === "battle-cut-in battle-cut-in--enemy")
    .at(-1)
  const mobileText = createdElements
    .filter((element) => element.className === "battle-cut-in__text")
    .at(-1)
  assert.equal(mobileRectangle.style.height, "5rem")
  assert.equal(mobileText.style.fontSize, "2.5rem")
  assert.equal(body.children.length, 0)
})
