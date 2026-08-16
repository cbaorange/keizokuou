import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import {
  animateHpBar,
  BATTLE_PREPARATION_FAILURE_CLASSIFICATIONS,
  BattleViewPreparationError,
  beginBattleEntryCoverFade,
  ENEMY_DOM_SLOTS,
  finishBattleEntryCover,
  prepareBattleView,
  renderBattleDecks,
  renderBattleResult,
  setBattleStatusSelected,
  setBattleScreenAvailability,
  showBattlePreparationError,
  setupBattleSurrenderDialog,
  validateBattleDom,
  validateBattleMobileConfig,
  waitForUserCardSelection
} from "../../../app/javascript/battle_dom.js"

class FakeClassList {
  constructor() {
    this.values = new Set()
  }

  add(...values) {
    values.forEach((value) => this.values.add(value))
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(value))
  }

  contains(value) {
    return this.values.has(value)
  }
}

class FakeElement {
  constructor({ dataset = {}, children = {}, attributes = {}, rect = {} } = {}) {
    this.dataset = { ...dataset }
    this.children = children
    this.attributes = { ...attributes }
    this.style = {}
    this.hidden = false
    this.inert = false
    this.disabled = false
    this.focused = false
    this.src = ""
    this.alt = ""
    this.textContent = ""
    this.listeners = new Map()
    this.animations = []
    this.classList = new FakeClassList()
    this.rect = { bottom: 0, height: 0, ...rect }
  }

  querySelector(selector) {
    return this.children[selector] || null
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
  }

  getAttribute(name) {
    return this.attributes[name] ?? null
  }

  hasAttribute(name) {
    return Object.hasOwn(this.attributes, name)
  }


  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  click() {
    const event = { target: this, preventDefault() {} }
    for (const listener of [...(this.listeners.get("click") || [])]) listener(event)
  }

  dispatch(type) {
    const event = { target: this, type }
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event)
  }

  focus() { this.focused = true }

  getBoundingClientRect() { return this.rect }

  listenerCount(type) {
    return this.listeners.get(type)?.size || 0
  }

  animate(keyframes, options) {
    this.animations.push({ keyframes, options })
    return { finished: Promise.resolve(), cancel() {} }
  }
}

function createStatus(team, slot) {
  const children = {}
  for (const role of [
    "portrait",
    "card-name",
    "level",
    "hp-bar",
    "hp-fill",
    "current-hp",
    "max-hp",
    "status-values"
  ]) {
    children[`[data-role="${role}"]`] = new FakeElement()
  }
  return new FakeElement({ dataset: { team, slot }, children })
}

function createMobileHud(team, slot) {
  const children = {}
  for (const role of ["mobile-level", "mobile-hp-bar", "mobile-hp-fill", "mobile-current-hp"]) {
    children[`[data-role="${role}"]`] = new FakeElement()
  }
  return new FakeElement({ dataset: { team, slot, cardId: "" }, children })
}

function createRoot() {
  const userSlots = ["A", "B", "C", "D", "E"]
  const enemySlots = [...ENEMY_DOM_SLOTS]
  const cards = new Map()
  const statuses = new Map()

  for (const [team, slots] of [["user", userSlots], ["enemy", enemySlots]]) {
    for (const slot of slots) {
      const mobileHud = createMobileHud(team, slot)
      cards.set(`${team}/${slot}`, new FakeElement({
        dataset: {
          team,
          slot,
          cardId: "",
          isRental: "false",
          selected: "false",
          deployed: "false",
          canBattle: "true"
        },
        attributes: { "aria-disabled": "false" },
        children: {
          '[data-role="card-image"]': new FakeElement(),
          '[data-battle-animation-position]': new FakeElement(),
          '[data-battle-animation-size]': new FakeElement(),
          '[data-battle-animation-orientation]': new FakeElement(),
          '[data-battle-animation-flip]': new FakeElement(),
          '[data-battle-animation-selection]': new FakeElement(),
          '[data-battle-animation-attack]': new FakeElement(),
          '[data-battle-animation-shadow]': new FakeElement(),
          '[data-battle-animation-motion]': new FakeElement(),
          '[data-battle-effect-layer]': new FakeElement(),
          '[data-battle-mobile-hud]': mobileHud
        }
      }))
      statuses.set(`${team}/${slot}`, createStatus(team, slot))
    }
  }

  const selectorLists = {
    '.battle__hand--user .battle__hand-card[data-team="user"][data-slot]': userSlots.map((slot) => cards.get(`user/${slot}`)),
    '.battle__hand--enemy .battle__hand-card[data-team="enemy"][data-slot]': enemySlots.map((slot) => cards.get(`enemy/${slot}`)),
    '.battle__status-list--right .battle__status-item[data-team="user"][data-slot]': userSlots.map((slot) => statuses.get(`user/${slot}`)),
    '.battle__status-list--left .battle__status-item[data-team="enemy"][data-slot]': enemySlots.map((slot) => statuses.get(`enemy/${slot}`)),
    '.battle__center-panel[data-team="enemy"]': [new FakeElement()],
    '.battle__center-panel[data-team="user"]': [new FakeElement()],
    '[data-battle-defeat-effect-layer][data-team="enemy"]': [new FakeElement()],
    '[data-battle-defeat-effect-layer][data-team="user"]': [new FakeElement()]
  }

  return {
    cards,
    statuses,
    selectorLists,
    querySelectorAll(selector) {
      return selectorLists[selector] || []
    },
    querySelector(selector) {
      const match = selector.match(/\.battle__(?:hand-card|status-item)\[data-team="(user|enemy)"\]\[data-slot="([A-Z])"\]/)
      if (match === null) return null
      return selector.startsWith(".battle__hand-card")
        ? cards.get(`${match[1]}/${match[2]}`)
        : statuses.get(`${match[1]}/${match[2]}`)
    }
  }
}

function createUserSelectionFixture() {
  const root = createRoot()
  const userCards = {}
  for (const [index, slot] of ["A", "B", "C", "D", "E"].entries()) {
    userCards[slot] = createCard(index + 1)
    root.cards.get(`user/${slot}`).dataset.cardId = String(index + 1)
    root.statuses.get(`user/${slot}`).dataset.cardId = String(index + 1)
  }
  return {
    root,
    userCards,
    battleAreaElement: new FakeElement({ rect: { width: 200, height: 300 } })
  }
}

const battleStatusAnimationConfig = {
  battle_status: {
    selected_shift_ratio: 0.2,
    selected_shift_duration_ms: 100,
    user_background_color: { r: 66, g: 150, b: 252 },
    enemy_background_color: { r: 252, g: 66, b: 0 }
  }
}

const flushSelection = () => new Promise((resolve) => setImmediate(resolve))

function createCard(id, isRental = false) {
  return {
    id,
    level: isRental ? null : id + 2,
    initialHp: 100,
    currentHp: 100,
    currentSpd: 90,
    canBattle: true,
    isRental
  }
}

test("AからEを左から、ZからVを左から並べるDOM契約を検証する", () => {
  const root = createRoot()
  assert.equal(validateBattleDom(root), true)
  assert.deepEqual(root.selectorLists['.battle__hand--enemy .battle__hand-card[data-team="enemy"][data-slot]'].map((item) => item.dataset.slot), ["Z", "Y", "X", "W", "V"])

  root.selectorLists['.battle__hand--user .battle__hand-card[data-team="user"][data-slot]'].reverse()
  assert.throws(() => validateBattleDom(root), /ユーザー手札のスロット順が不正/)
})

test("必須の状態属性不足を明示的なDOM契約エラーにする", () => {
  const root = createRoot()
  delete root.cards.get("user/A").dataset.canBattle

  assert.throws(() => validateBattleDom(root), /data-can-battleがありません/)
})

test("カードのposition・size・orientation・flip・selection・attackを別要素に分離する", () => {
  const root = createRoot()
  assert.equal(validateBattleDom(root), true)

  const userA = root.cards.get("user/A")
  const parts = [
    '[data-battle-animation-position]',
    '[data-battle-animation-size]',
    '[data-battle-animation-orientation]',
    '[data-battle-animation-flip]',
    '[data-battle-animation-selection]',
    '[data-battle-animation-attack]'
  ].map((selector) => userA.querySelector(selector))
  assert.equal(new Set(parts).size, 6)
})

test("暗転レイヤーよりカードとステータスが前、案内が最前面になるSCSS契約", async () => {
  const [fieldScss, overlayScss, animationScss, statusScss, battleScreen] = await Promise.all([
    readFile(new URL("../../../app/assets/stylesheets/battles/_field.scss", import.meta.url), "utf8"),
    readFile(new URL("../../../app/assets/stylesheets/battles/_overlays.scss", import.meta.url), "utf8"),
    readFile(new URL("../../../app/assets/stylesheets/battles/_animations.scss", import.meta.url), "utf8"),
    readFile(new URL("../../../app/assets/stylesheets/battles/_status.scss", import.meta.url), "utf8"),
    readFile(new URL("../../../app/views/battles/_battle_screen.html.erb", import.meta.url), "utf8")
  ])

  assert.match(fieldScss, /\.battle\s*\{[\s\S]*isolation:\s*isolate/)
  assert.match(fieldScss, /\.battle__foreground\s*\{[\s\S]*z-index:\s*3/)
  assert.match(animationScss, /\.battle-animation-choice-dim\s*\{[\s\S]*z-index:\s*2/)
  assert.match(animationScss, /\.battle-animation-choice-prompt,[\s\S]*z-index:\s*6/)
  assert.match(animationScss, /\.battle-defeat-effect-layer\s*\{[\s\S]*z-index:\s*5/)
  assert.match(overlayScss, /\.battle-animation-choice-dim\s*\{[\s\S]*backdrop-filter:\s*blur\(\$battle-overlay-blur\)/)
  assert.match(overlayScss, /-webkit-backdrop-filter:\s*blur\(\$battle-overlay-blur\)/)
  assert.doesNotMatch(overlayScss, /\.battle__blind/)
  assert.doesNotMatch(battleScreen, /battle__blind/)
  assert.match(overlayScss, /\.battle-surrender-button\s*\{[\s\S]*z-index:\s*9/)
  assert.match(overlayScss, /\.battle-surrender-layer\s*\{[\s\S]*z-index:\s*200/)
  assert.match(overlayScss, /\.battle-surrender-button\s*\{[\s\S]*right:\s*var\(--space-4\)/)
  assert.match(overlayScss, /\.battle-surrender-dialog__title\s*\{[\s\S]*font-size:\s*var\(--font-size-body\)/)
  assert.match(statusScss, /\.battle__status-item\[data-team="enemy"\]::before/)
  assert.match(statusScss, /\.battle__status-item\[data-team="user"\]::after/)
  assert.match(statusScss, /--battle-status-edge-gradient-width:\s*55%/)
  assert.match(statusScss, /--battle-status-portrait-radius:\s*clamp\(1\.5rem, 2vw, 2\.375rem\)/)
  assert.match(statusScss, /--battle-status-level-side-gradient-width:\s*calc\(\(var\(--space-2\) \+ var\(--battle-status-portrait-radius\)\) \+ \(var\(--space-2\) \+ var\(--battle-status-portrait-radius\)\)\)/)
  assert.match(statusScss, /--battle-status-portrait-side-gradient-width:\s*var\(--battle-status-level-side-gradient-width\)/)
  assert.match(statusScss, /--battle-status-seam-overlap:\s*1px/)
  assert.match(statusScss, /\.battle__status-item\s*\{[\s\S]*width:\s*100%/)
  assert.doesNotMatch(statusScss, /\.battle__status-item--deployed\s*\{[\s\S]*width:\s*fit-content/)
  assert.match(statusScss, /\.battle__status-item--deployed\[data-team="enemy"\]\s*\{[\s\S]*transparent calc\(var\(--battle-status-portrait-side-gradient-width\) - var\(--battle-status-seam-overlap\)\)[\s\S]*transparent calc\(\(100% - var\(--battle-status-level-side-gradient-width\)\) \+ var\(--battle-status-seam-overlap\)\)/)
  assert.match(statusScss, /\.battle__status-item--deployed\[data-team="user"\]\s*\{[\s\S]*transparent calc\(var\(--battle-status-level-side-gradient-width\) - var\(--battle-status-seam-overlap\)\)[\s\S]*transparent calc\(\(100% - var\(--battle-status-portrait-side-gradient-width\)\) \+ var\(--battle-status-seam-overlap\)\)/)
  assert.match(statusScss, /\.battle__status-item--deployed\[data-team="user"\]\s*\{[\s\S]*flex-direction:\s*row-reverse/)
  assert.match(statusScss, /\.battle__status-item--deployed\[data-team="enemy"\]::before\s*\{[\s\S]*left:\s*0[\s\S]*width:\s*var\(--battle-status-portrait-side-gradient-width\)/)
  assert.match(statusScss, /\.battle__status-item--deployed\[data-team="enemy"\]::after\s*\{[\s\S]*right:\s*0[\s\S]*width:\s*var\(--battle-status-level-side-gradient-width\)/)
  assert.match(statusScss, /\.battle__status-item--deployed\[data-team="user"\]::before\s*\{[\s\S]*left:\s*0[\s\S]*width:\s*var\(--battle-status-level-side-gradient-width\)/)
  assert.match(statusScss, /\.battle__status-item--deployed\[data-team="user"\]::after\s*\{[\s\S]*right:\s*0[\s\S]*width:\s*var\(--battle-status-portrait-side-gradient-width\)/)
  assert.doesNotMatch(statusScss, /\.battle__status-item--deployed\[data-team="user"\]::before\s*\{[\s\S]*clip-path:/)
  assert.match(statusScss, /--battle-status-row-height:\s*clamp\(3rem, 7vh, 4\.75rem\)/)
  assert.match(statusScss, /\.battle__status-placeholder\s*\{[\s\S]*height:\s*var\(--battle-status-row-height\)[\s\S]*visibility:\s*hidden[\s\S]*pointer-events:\s*none/)
  assert.match(statusScss, /rgba\(var\(--battle-status-rgb, 28, 28, 28\), 0\.1215686275\)/)
  assert.match(statusScss, /rgba\(var\(--battle-status-rgb, 28, 28, 28\), 0\.9215686275\)/)
  assert.match(statusScss, /rgba\(var\(--battle-status-rgb, 28, 28, 28\), 1\)/)
  assert.doesNotMatch(statusScss, /var\(--gray-2-transparent-(?:soft|strong)\)/)
  assert.match(statusScss, /\.battle__status-item--selectable\s*\{[\s\S]*cursor:\s*pointer/)
  assert.match(statusScss, /\.battle__status-metrics\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) max-content/)
  assert.match(statusScss, /\.battle__status-name\s*\{[\s\S]*font-size:\s*var\(--font-size-body\)/)
  assert.match(statusScss, /\.battle__status-level,[\s\S]*\.battle__hp-values\s*\{[\s\S]*font-size:\s*var\(--font-size-small\)/)
})

test("通常・レンタルカードと初期HP・100%バーを描画する", () => {
  const root = createRoot()
  const syukamonData = {
    one: { id: 1, name: "正式な一号", short_name: "一号" },
    two: { id: 2, name: "正式な二号", short_name: "二号" }
  }
  const userCards = Object.fromEntries(["A", "B", "C", "D", "E"].map((slot, index) => [slot, createCard(index === 0 ? 1 : 2, index > 0)]))
  const enemyCards = Object.fromEntries(["V", "W", "X", "Y", "Z"].map((slot, index) => [slot, createCard(index === 0 ? 2 : 1, index === 0)]))

  renderBattleDecks({
    root,
    context: {
      userCards,
      enemyCards,
      syukamonData,
      assets: {
        cardImageUrls: { "1": "/cards/1.PNG", "2": "/cards/2.PNG" },
        rentalCardImageUrls: { "1": "/rental_cards/1.PNG", "2": "/rental_cards/2.PNG" },
        portraitImageUrls: { "1": "/portraits/1.PNG", "2": "/portraits/2.PNG" }
      },
      config: { animations: battleStatusAnimationConfig }
    }
  })

  const userA = root.cards.get("user/A")
  const userB = root.cards.get("user/B")
  const userAStatus = root.statuses.get("user/A")
  const userBStatus = root.statuses.get("user/B")
  const enemyV = root.cards.get("enemy/V")
  const enemyVStatus = root.statuses.get("enemy/V")
  assert.equal(userA.dataset.cardId, "1")
  assert.equal(userA.dataset.isRental, "false")
  assert.equal(userB.dataset.isRental, "true")
  assert.equal(userA.dataset.selected, "false")
  assert.equal(userA.dataset.deployed, "false")
  assert.equal(userA.attributes["aria-disabled"], "false")
  assert.equal(userAStatus.children['[data-role="current-hp"]'].textContent, "100")
  assert.equal(userAStatus.children['[data-role="hp-fill"]'].style.width, "100%")
  assert.equal(userAStatus.children['[data-role="portrait"]'].src, "/portraits/1.PNG")
  assert.equal(userAStatus.children['[data-role="card-name"]'].textContent, "一号")
  assert.equal(userAStatus.children['[data-role="level"]'].textContent, "Lv. 3")
  assert.equal(userBStatus.children['[data-role="level"]'].textContent, "レンタル")
  assert.equal(enemyVStatus.children['[data-role="level"]'].textContent, "レンタル")
  assert.equal(userA.querySelector('[data-role="card-image"]').src, "/cards/1.PNG")
  assert.equal(userB.querySelector('[data-role="card-image"]').src, "/rental_cards/2.PNG")
  assert.equal(enemyV.querySelector('[data-role="card-image"]').src, "/rental_cards/2.PNG")
  assert.equal(userBStatus.children['[data-role="portrait"]'].src, "/portraits/2.PNG")
  assert.equal(enemyVStatus.children['[data-role="portrait"]'].src, "/portraits/2.PNG")
  assert.equal(userAStatus.children['[data-role="portrait"]'].alt, "一号のポートレート")
  assert.equal(userA.querySelector('[data-role="card-image"]').alt, "一号のカード")
  assert.equal(userAStatus.style["--battle-status-rgb"], "66, 150, 252")
  assert.equal(root.statuses.get("enemy/V").style["--battle-status-rgb"], "252, 66, 0")
  assert.equal(userA.querySelector('[data-battle-mobile-hud]').dataset.cardId, "1")
  assert.equal(userA.querySelector('[data-battle-mobile-hud]').children['[data-role="mobile-level"]'].textContent, "Lv. 3")
  assert.equal(userB.querySelector('[data-battle-mobile-hud]').children['[data-role="mobile-level"]'].textContent, "レンタル")
  assert.equal(enemyV.querySelector('[data-battle-mobile-hud]').children['[data-role="mobile-level"]'].textContent, "レンタル")
  assert.equal(userA.querySelector('[data-battle-mobile-hud]').children['[data-role="mobile-current-hp"]'].textContent, "100")
})

test("battle_mobileの手札・戦闘エリア・カットイン設定を指定範囲で検証する", () => {
  const config = {
    battle_mobile: {
      user_hand: { card_gap_ratio: 0.05, vertical_edge_margin_ratio: 0.1, edge_margin_ratio: 0.1 },
      hp: { bar_width_ratio: 0.6, user_text_font_size_rem: 0.9 },
      level: { offset_x_ratio: 0.1, offset_y_ratio: 0.1, user_font_size_rem: 0.7 },
      battle_area: { center_offset_y_ratio: 0.16 },
      cut_in: { rectangle_height_rem: 5, text: { font_size_rem: 2.5 } }
    }
  }
  assert.equal(validateBattleMobileConfig(config), config.battle_mobile)

  config.battle_mobile.battle_area.center_offset_y_ratio = 0.5
  assert.throws(() => validateBattleMobileConfig(config), /0.5未満/)
})

test("portrait専用SCSSはCSS orientationだけでPC statusとmobile HUDを切り替える", async () => {
  const [fieldScss, handsScss, mobileScss] = await Promise.all([
    readFile(new URL("../../../app/assets/stylesheets/battles/_field.scss", import.meta.url), "utf8"),
    readFile(new URL("../../../app/assets/stylesheets/battles/_hands.scss", import.meta.url), "utf8"),
    readFile(new URL("../../../app/assets/stylesheets/battles/_mobile.scss", import.meta.url), "utf8")
  ])

  assert.match(mobileScss, /@media \(orientation: portrait\)/)
  assert.match(fieldScss, /--battle-user-card-width:\s*clamp\(7rem, 9\.4vw, 11\.25rem\)/)
  assert.match(fieldScss, /width:\s*calc\(var\(--battle-user-card-width\) \+ \(var\(--battle-area-card-padding\) \* 2\)\)/)
  assert.match(fieldScss, /height:\s*calc\(var\(--battle-user-card-height\) \+ \(var\(--battle-area-card-padding\) \* 2\)\)/)
  assert.match(fieldScss, /border-radius:\s*calc\([\s\S]*var\(--battle-area-border-radius-ratio\)/)
  assert.match(handsScss, /--battle-hand-card-width:\s*var\(--battle-user-card-width\)/)
  assert.match(mobileScss, /--battle-user-card-width:\s*var\(--battle-mobile-user-card-width\)/)
  assert.match(mobileScss, /--battle-user-card-height:\s*var\(--battle-mobile-user-card-height\)/)
  assert.match(mobileScss, /\.battle__status-item,[\s\S]*display:\s*none !important/)
  assert.match(mobileScss, /\.battle-mobile-card-hud\.is-battle-hidden\s*\{[\s\S]*display:\s*none/)
  assert.match(mobileScss, /gap:\s*var\(--battle-mobile-card-gap\)/)
  assert.match(mobileScss, /\.battle__hand--enemy[\s\S]*top:\s*var\(--battle-mobile-vertical-edge-margin\)/)
  assert.match(mobileScss, /\.battle__hand--user[\s\S]*bottom:\s*var\(--battle-mobile-vertical-edge-margin\)/)
  assert.match(mobileScss, /\.battle__center-row--enemy[\s\S]*top:\s*var\(--battle-mobile-enemy-area-center-y\)/)
  assert.match(mobileScss, /\.battle__center-row--user[\s\S]*top:\s*var\(--battle-mobile-user-area-center-y\)/)
  assert.match(mobileScss, /--battle-responsive-cut-in-rectangle-height:\s*var\(--battle-mobile-cut-in-rectangle-height\)/)
  assert.match(mobileScss, /--battle-responsive-cut-in-text-font-size:\s*var\(--battle-mobile-cut-in-text-font-size\)/)
  assert.match(mobileScss, /\.battle-mobile-card-hud__level\s*\{[\s\S]*top:\s*var\(--battle-mobile-level-offset-y-percent\);[\s\S]*left:\s*var\(--battle-mobile-level-offset-x-percent\)/)
  assert.match(mobileScss, /\.battle-mobile-card-hud__hp-bar\s*\{[\s\S]*--battle-mobile-hp-bar-height:\s*0\.25rem;[\s\S]*border:\s*calc\(var\(--battle-mobile-hp-bar-height\) \/ 3\) solid #fff/)
  assert.match(mobileScss, /\.battle-surrender-button\s*\{[\s\S]*min-width:\s*calc\(5rem \* 0\.5\);[\s\S]*min-height:\s*calc\(2\.75rem \* 0\.5\);[\s\S]*font-size:\s*var\(--font-size-small\)/)
  assert.match(mobileScss, /\.battle-result-screen__actions\s*\{[\s\S]*flex-direction:\s*column/)
  assert.match(mobileScss, /--battle-mobile-result-card-height:\s*24vh/)
  assert.match(mobileScss, /margin-top:\s*calc\(var\(--battle-mobile-result-card-height\) \* 0\.5\)/)
  assert.match(mobileScss, /button\[data-battle-result-action="rematch"\][\s\S]*order:\s*1/)
  assert.match(mobileScss, /button\[data-battle-result-action="finish"\][\s\S]*order:\s*2/)
  assert.doesNotMatch(mobileScss, /battle-mobile-user-overlap|overlap-shadow/)
  assert.doesNotMatch(mobileScss, /transform:\s*scale\(0\.5\)/)
  assert.doesNotMatch(mobileScss, /window\.(?:innerWidth|innerHeight)/)
})

test("選択statusを戦闘エリア幅の設定倍率だけ左へ移動し、同じ時間で戻す", async () => {
  const statusElement = new FakeElement()
  const battleAreaElement = new FakeElement({ rect: { width: 200, height: 300 } })

  const selectedShift = await setBattleStatusSelected({
    statusElement,
    battleAreaElement,
    selected: true,
    config: battleStatusAnimationConfig
  })
  assert.equal(selectedShift, -40)
  assert.equal(statusElement.style.transform, "translateX(-40px)")
  assert.equal(statusElement.animations[0].options.duration, 100)

  const resetShift = await setBattleStatusSelected({
    statusElement,
    battleAreaElement,
    selected: false,
    config: battleStatusAnimationConfig
  })
  assert.equal(resetShift, 0)
  assert.equal(statusElement.style.transform, "translateX(0px)")
  assert.equal(statusElement.animations[1].options.duration, 100)
})

test("開始遮蔽を指定時間で透明化し、完了後に操作対象から外す", () => {
  const cover = new FakeElement()
  cover.offsetWidth = 100

  beginBattleEntryCoverFade({ coverElement: cover, durationMs: 500 })
  assert.equal(cover.hidden, false)
  assert.equal(cover.style.transition, "opacity 500ms linear")
  assert.equal(cover.style.opacity, "0")
  assert.equal(cover.style.pointerEvents, "auto")

  finishBattleEntryCover({ coverElement: cover })
  assert.equal(cover.hidden, true)
  assert.equal(cover.style.pointerEvents, "none")
})

function createBattlePreparationFixture({ decodeFailures = 0, waitForFirstDecode = false, useDecode = true } = {}) {
  let resolveDecode
  let decodeCalls = 0
  const image = new FakeElement({ rect: { width: 100, height: 160 } })
  image.src = "/cards/1.PNG"
  image.complete = false
  if (useDecode) {
    image.decode = () => {
      decodeCalls += 1
      if (waitForFirstDecode && decodeCalls === 1) {
        return new Promise((resolve) => { resolveDecode = resolve })
      }
      return decodeCalls <= decodeFailures
        ? Promise.reject(new Error(`decode failed ${decodeCalls}`))
        : Promise.resolve()
    }
  }

  const createCardElement = () => {
    const position = new FakeElement({ rect: { width: 100, height: 160 } })
    return new FakeElement({
      rect: { width: 100, height: 160 },
      children: { '[data-battle-animation-position]': position }
    })
  }
  const cards = Array.from({ length: 10 }, createCardElement)
  const battleElement = new FakeElement({ rect: { width: 1280, height: 720 } })
  battleElement.classList.add("battle--cards-awaiting-entry")
  battleElement.querySelectorAll = (selector) => selector === "img" ? [image] : []
  const documentRef = {
    fonts: { ready: Promise.resolve() },
    defaultView: {
      getComputedStyle: () => ({ transform: "matrix(1, 0, 0, 1, 0, 160)" })
    }
  }
  const battleUi = {
    battleElement,
    userCardElements: cards.slice(0, 5),
    enemyCardElements: cards.slice(5),
    userStatusListElement: new FakeElement({ rect: { width: 220, height: 400 } }),
    enemyStatusListElement: new FakeElement({ rect: { width: 220, height: 400 } }),
    userBattleAreaElement: new FakeElement({ rect: { width: 180, height: 280 } }),
    enemyBattleAreaElement: new FakeElement({ rect: { width: 180, height: 280 } })
  }
  let frameCount = 0
  const requestFrame = (callback) => {
    frameCount += 1
    queueMicrotask(callback)
  }

  return {
    battleUi,
    documentRef,
    image,
    requestFrame,
    logger: { warn() {} },
    resolveDecode: () => resolveDecode?.(),
    getDecodeCalls: () => decodeCalls,
    getFrameCount: () => frameCount
  }
}

test("カード画像decodeと2回の描画境界後にbattle view準備を完了する", async () => {
  const fixture = createBattlePreparationFixture({ waitForFirstDecode: true })
  let completed = false
  const preparation = prepareBattleView(fixture).then((result) => {
    completed = true
    return result
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(completed, false)
  assert.equal(fixture.getFrameCount(), 0)
  fixture.resolveDecode()
  const result = await preparation

  assert.equal(result.imageCount, 1)
  assert.equal(fixture.getFrameCount(), 2)
})

test("カード画像decodeが1回失敗しても失敗画像だけ再試行して準備を完了する", async () => {
  const fixture = createBattlePreparationFixture({ decodeFailures: 1 })
  const result = await prepareBattleView(fixture)

  assert.equal(result.imageCount, 1)
  assert.equal(fixture.getDecodeCalls(), 2)
  assert.equal(fixture.getFrameCount(), 2)
})

test("カード画像decodeが2回失敗しても軽微な失敗として準備を完了する", async () => {
  const fixture = createBattlePreparationFixture({ decodeFailures: 2 })
  const result = await prepareBattleView(fixture)

  assert.equal(result.imageCount, 1)
  assert.equal(fixture.getDecodeCalls(), 2)
  assert.equal(fixture.getFrameCount(), 2)
})

test("decode非対応時の画像errorは失敗画像だけ再読込し、2回目のloadで準備を完了する", async () => {
  const fixture = createBattlePreparationFixture({ useDecode: false })
  let completed = false
  const preparation = prepareBattleView(fixture).then((result) => {
    completed = true
    return result
  })

  await new Promise((resolve) => setImmediate(resolve))
  fixture.image.dispatch("error")
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(completed, false)
  fixture.image.dispatch("load")

  const result = await preparation
  assert.equal(result.imageCount, 1)
  assert.equal(fixture.getFrameCount(), 2)
})

test("FontFaceSet.readyのrejectは無意味な再試行をせず軽微な失敗として継続する", async () => {
  const fixture = createBattlePreparationFixture()
  fixture.documentRef.fonts.ready = Promise.reject(new Error("font failed"))

  const result = await prepareBattleView(fixture)
  assert.equal(result.imageCount, 1)
  assert.equal(fixture.getDecodeCalls(), 1)
  assert.equal(fixture.getFrameCount(), 2)
})

test("必須DOMの表示サイズ0は再試行対象としてrejectする", async () => {
  const fixture = createBattlePreparationFixture()
  fixture.battleUi.userBattleAreaElement.rect.width = 0

  await assert.rejects(
    prepareBattleView(fixture),
    (error) => error instanceof BattleViewPreparationError &&
      error.classification === BATTLE_PREPARATION_FAILURE_CLASSIFICATIONS.RETRYABLE &&
      error.elementLabel === "ユーザー戦闘エリア"
  )
})

test("必須DOM API欠損は致命的な契約違反としてrejectする", async () => {
  const fixture = createBattlePreparationFixture()
  fixture.battleUi.battleElement.querySelectorAll = null

  await assert.rejects(
    prepareBattleView(fixture),
    /querySelectorAllは関数である必要があります/
  )
})

test("事前準備エラー画面はcoverとbattle操作を止めて習慣画面リンクへfocusする", () => {
  const battleElement = new FakeElement()
  const coverElement = new FakeElement()
  const errorScreen = new FakeElement()
  errorScreen.hidden = true
  errorScreen.inert = true
  const returnElement = new FakeElement()

  const shown = showBattlePreparationError({
    pageUi: {
      preparationErrorScreenElement: errorScreen,
      preparationErrorReturnElement: returnElement
    },
    battleUi: { battleElement, entryCoverElement: coverElement }
  })

  assert.equal(shown, errorScreen)
  assert.equal(coverElement.hidden, true)
  assert.equal(coverElement.style.pointerEvents, "none")
  assert.equal(battleElement.hidden, true)
  assert.equal(battleElement.inert, true)
  assert.equal(battleElement.getAttribute("aria-hidden"), "true")
  assert.equal(errorScreen.hidden, false)
  assert.equal(errorScreen.inert, false)
  assert.equal(errorScreen.getAttribute("aria-hidden"), "false")
  assert.equal(returnElement.focused, true)
})

test("1回目で選択し、別カードへ切り替え、同じカードの2回目で確定してリスナーを外す", async () => {
  const { root, userCards, battleAreaElement } = createUserSelectionFixture()
  const motions = []
  const selection = waitForUserCardSelection({
    root,
    userCards,
    battleAreaElement,
    config: {},
    selectMotion: async ({ cardElement }) => { motions.push(`select:${cardElement.dataset.slot}`) },
    deselectMotion: async ({ cardElement }) => { motions.push(`deselect:${cardElement.dataset.slot}`) },
    selectStatusMotion: async ({ entry }) => { motions.push(`status-select:${entry.slot}`) },
    deselectStatusMotion: async ({ entry }) => { motions.push(`status-deselect:${entry.slot}`) }
  })

  root.statuses.get("user/A").click()
  await flushSelection()
  assert.equal(root.cards.get("user/A").dataset.selected, "true")

  root.cards.get("user/B").click()
  await flushSelection()
  assert.equal(root.cards.get("user/A").dataset.selected, "false")
  assert.equal(root.cards.get("user/B").dataset.selected, "true")

  root.cards.get("user/B").click()
  const result = await selection
  assert.equal(result.slot, "B")
  assert.equal(root.cards.get("user/B").dataset.deployed, "true")
  assert.deepEqual(motions, [
    "select:A",
    "status-select:A",
    "deselect:A",
    "status-deselect:A",
    "select:B",
    "status-select:B",
    "status-deselect:B"
  ])
  assert.ok([...root.cards.values()].filter((card) => card.dataset.team === "user").every((card) => card.listenerCount("click") === 0))
  assert.ok([...root.statuses.values()].filter((status) => status.dataset.team === "user").every((status) => status.listenerCount("click") === 0))
})

test("statusクリックを同じteamとslotのカード入力としてカードクリックと共通処理する", async () => {
  const { root, userCards, battleAreaElement } = createUserSelectionFixture()
  const motions = []
  const selection = waitForUserCardSelection({
    root,
    userCards,
    battleAreaElement,
    config: {},
    selectMotion: async ({ cardElement }) => { motions.push(`select:${cardElement.dataset.slot}`) },
    deselectMotion: async ({ cardElement }) => { motions.push(`deselect:${cardElement.dataset.slot}`) },
    selectStatusMotion: async ({ entry }) => { motions.push(`status-select:${entry.slot}`) },
    deselectStatusMotion: async ({ entry }) => { motions.push(`status-deselect:${entry.slot}`) }
  })

  root.statuses.get("user/A").click()
  await flushSelection()
  root.statuses.get("user/B").click()
  await flushSelection()
  root.cards.get("user/B").click()

  const result = await selection
  assert.equal(result.slot, "B")
  assert.equal(root.cards.get("user/A").dataset.selected, "false")
  assert.equal(root.cards.get("user/B").dataset.deployed, "true")
  assert.deepEqual(motions, [
    "select:A",
    "status-select:A",
    "deselect:A",
    "status-deselect:A",
    "select:B",
    "status-select:B",
    "status-deselect:B"
  ])
})

test("撃破済みカードを選択せず、高速二重クリックでも1回だけ確定する", async () => {
  const { root, userCards, battleAreaElement } = createUserSelectionFixture()
  userCards.A.canBattle = false
  root.cards.get("user/A").dataset.canBattle = "false"
  root.cards.get("user/A").setAttribute("aria-disabled", "true")
  let selectCount = 0
  const selection = waitForUserCardSelection({
    root,
    userCards,
    battleAreaElement,
    config: {},
    selectMotion: async () => { selectCount += 1 },
    deselectMotion: async () => {},
    selectStatusMotion: async () => {},
    deselectStatusMotion: async () => {}
  })

  root.statuses.get("user/A").click()
  root.cards.get("user/B").click()
  root.cards.get("user/B").click()
  const result = await selection
  assert.equal(result.slot, "B")
  assert.equal(selectCount, 1)
  assert.equal(root.cards.get("user/A").dataset.selected, "false")
  root.cards.get("user/B").click()
  assert.equal(selectCount, 1)
})

test("選択待機の中断時に全クリックリスナーを解除する", async () => {
  const { root, userCards, battleAreaElement } = createUserSelectionFixture()
  const controller = new AbortController()
  const selection = waitForUserCardSelection({
    root,
    userCards,
    battleAreaElement,
    config: {},
    signal: controller.signal,
    selectMotion: async () => {},
    deselectMotion: async () => {},
    selectStatusMotion: async () => {},
    deselectStatusMotion: async () => {}
  })

  controller.abort()
  await assert.rejects(selection, { name: "AbortError" })
  assert.ok([...root.cards.values()].filter((card) => card.dataset.team === "user").every((card) => card.listenerCount("click") === 0))
  assert.ok([...root.statuses.values()].filter((status) => status.dataset.team === "user").every((status) => status.listenerCount("click") === 0))
})

test("選択モーション中だけ降参受付を無効にし、入力待ちへ戻ると再び有効にする", async () => {
  const { root, userCards, battleAreaElement } = createUserSelectionFixture()
  const availability = []
  const selection = waitForUserCardSelection({
    root,
    userCards,
    battleAreaElement,
    config: {},
    onBusyChange: (busy) => availability.push(!busy),
    selectMotion: async () => {},
    deselectMotion: async () => {},
    selectStatusMotion: async () => {},
    deselectStatusMotion: async () => {}
  })

  root.cards.get("user/A").click()
  await flushSelection()
  root.cards.get("user/A").click()
  await selection

  assert.deepEqual(availability, [false, true, false])
})

test("降参確認はbattleをinertにし、取消・背景・Escapeで状態を変えず閉じる", () => {
  const openButton = new FakeElement()
  const cancelButton = new FakeElement()
  const confirmButton = new FakeElement()
  const layer = new FakeElement({
    children: {
      "[data-battle-surrender-cancel]": cancelButton,
      "[data-battle-surrender-confirm]": confirmButton
    }
  })
  const battleElement = new FakeElement()
  const root = new FakeElement({
    children: {
      "[data-battle-surrender-open]": openButton,
      "[data-battle-surrender-layer]": layer
    }
  })
  let confirms = 0
  const controls = setupBattleSurrenderDialog({
    root,
    battleElement,
    onConfirm: () => { confirms += 1 }
  })
  controls.setVisible(true)
  controls.setEnabled(true)

  openButton.click()
  assert.equal(layer.hidden, false)
  assert.equal(battleElement.inert, true)
  assert.equal(cancelButton.focused, true)
  cancelButton.click()
  assert.equal(layer.hidden, true)
  assert.equal(battleElement.inert, false)
  assert.equal(confirms, 0)

  openButton.click()
  for (const listener of root.listeners.get("keydown")) {
    listener({ key: "Escape", preventDefault() {} })
  }
  assert.equal(layer.hidden, true)
  assert.equal(battleElement.inert, false)
  controls.destroy()
})

test("降参確定は1回だけ通知し、確認中の全操作を無効化する", () => {
  const openButton = new FakeElement()
  const cancelButton = new FakeElement()
  const confirmButton = new FakeElement()
  const layer = new FakeElement({
    children: {
      "[data-battle-surrender-cancel]": cancelButton,
      "[data-battle-surrender-confirm]": confirmButton
    }
  })
  const battleElement = new FakeElement()
  const root = new FakeElement({
    children: {
      "[data-battle-surrender-open]": openButton,
      "[data-battle-surrender-layer]": layer
    }
  })
  let confirms = 0
  const controls = setupBattleSurrenderDialog({
    root,
    battleElement,
    onConfirm: () => { confirms += 1 }
  })
  controls.setVisible(true)
  controls.setEnabled(true)
  openButton.click()
  confirmButton.click()
  confirmButton.click()

  assert.equal(confirms, 1)
  assert.equal(battleElement.inert, true)
  assert.equal(openButton.disabled, true)
  assert.equal(cancelButton.disabled, true)
  assert.equal(confirmButton.disabled, true)
  controls.finish()
  assert.equal(layer.hidden, true)
  controls.destroy()
})

test("降参ボタンは最下段ユーザーステータス下の余白を3等分した下側領域中央へ置く", () => {
  const openButton = new FakeElement({ rect: { height: 44 } })
  const cancelButton = new FakeElement()
  const confirmButton = new FakeElement()
  const userStatusList = new FakeElement({ rect: { bottom: 600 } })
  const layer = new FakeElement({
    children: {
      "[data-battle-surrender-cancel]": cancelButton,
      "[data-battle-surrender-confirm]": confirmButton
    }
  })
  const root = new FakeElement({
    children: {
      "[data-battle-surrender-open]": openButton,
      "[data-battle-surrender-layer]": layer,
      ".battle__status-list--right": userStatusList
    }
  })
  root.defaultView = { innerHeight: 900 }

  const controls = setupBattleSurrenderDialog({
    root,
    battleElement: new FakeElement(),
    onConfirm() {}
  })

  assert.equal(openButton.style.top, "850px")
  controls.destroy()
})

test("HPバー更新は数値変化時間を使い、HPバフ時も100%を上限にする", async () => {
  const hpFillElement = new FakeElement()
  const duration = await animateHpBar({
    hpFillElement,
    hpBefore: 80,
    hpAfter: 120,
    maxHp: 100,
    config: { duration_ms: 300, full_duration_change: 20, min_duration_ms: 0 }
  })

  assert.equal(duration, 300)
  assert.equal(hpFillElement.style.width, "100%")
  assert.deepEqual(hpFillElement.animations[0].keyframes, [{ width: "80%" }, { width: "100%" }])
})

test("リザルトDOMは勝敗・レート・同一カードの画像とセリフを描画する", () => {
  const resultScreenElement = new FakeElement()
  resultScreenElement.hidden = true
  const ui = {
    resultScreenElement,
    resultHeadingElement: new FakeElement(),
    resultRateBeforeElement: new FakeElement(),
    resultRateAfterElement: new FakeElement(),
    resultErrorElement: new FakeElement(),
    resultCardElement: new FakeElement(),
    resultDialogueElement: new FakeElement(),
    resultNameElement: new FakeElement(),
    resultMessageElement: new FakeElement()
  }

  renderBattleResult({
    ui,
    outcome: "win",
    rateBefore: 15,
    rateAfter: 182,
    cardView: {
      cardId: 1,
      name: "一号",
      cardImageUrl: "/cards/1.PNG",
      message: "勝ったよ"
    },
    cardWidth: 240
  })

  assert.equal(ui.resultHeadingElement.textContent, "Win!")
  assert.equal(ui.resultHeadingElement.classList.contains("battle-result-screen__heading--win"), true)
  assert.equal(ui.resultRateBeforeElement.textContent, "15")
  assert.equal(ui.resultRateAfterElement.textContent, "182")
  assert.equal(ui.resultCardElement.src, "/cards/1.PNG")
  assert.equal(ui.resultCardElement.style.width, "240px")
  assert.equal(ui.resultNameElement.textContent, "一号")
  assert.equal(ui.resultMessageElement.textContent, "勝ったよ")
  assert.equal(resultScreenElement.hidden, false)
  assert.equal(resultScreenElement.inert, false)
  assert.equal(resultScreenElement.getAttribute("aria-hidden"), "false")
})

test("通常カード0枚のリザルトはカードとセリフだけを空にして操作画面を表示する", () => {
  const resultScreenElement = new FakeElement()
  resultScreenElement.hidden = true
  const ui = {
    resultScreenElement,
    resultHeadingElement: new FakeElement(),
    resultRateBeforeElement: new FakeElement(),
    resultRateAfterElement: new FakeElement(),
    resultErrorElement: new FakeElement(),
    resultCardElement: new FakeElement(),
    resultDialogueElement: new FakeElement(),
    resultNameElement: new FakeElement(),
    resultMessageElement: new FakeElement()
  }

  renderBattleResult({
    ui,
    outcome: "lose",
    rateBefore: 15,
    rateAfter: 15,
    cardView: null,
    cardWidth: 240
  })

  assert.equal(ui.resultHeadingElement.textContent, "Lose...")
  assert.equal(ui.resultCardElement.hidden, true)
  assert.equal(ui.resultDialogueElement.hidden, true)
  assert.equal(resultScreenElement.hidden, false)
})

test("戦闘DOMは開始前・リザルト中にinertとaria-hiddenを同時制御する", () => {
  const battleElement = new FakeElement()

  setBattleScreenAvailability({ battleElement, available: false })
  assert.equal(battleElement.inert, true)
  assert.equal(battleElement.getAttribute("aria-hidden"), "true")

  setBattleScreenAvailability({ battleElement, available: true })
  assert.equal(battleElement.inert, false)
  assert.equal(battleElement.getAttribute("aria-hidden"), "false")
})

test("リザルトの色・勝敗文字・中央配置・初期カード位置をSCSS契約に持つ", async () => {
  const [overlayScss, animationScss, globalScss, showView, debugView] = await Promise.all([
    readFile(new URL("../../../app/assets/stylesheets/battles/_overlays.scss", import.meta.url), "utf8"),
    readFile(new URL("../../../app/assets/stylesheets/battles/_animations.scss", import.meta.url), "utf8"),
    readFile(new URL("../../../app/assets/stylesheets/base/_global.scss", import.meta.url), "utf8"),
    readFile(new URL("../../../app/views/battles/show.html.erb", import.meta.url), "utf8"),
    readFile(new URL("../../../app/views/battles/debug.html.erb", import.meta.url), "utf8")
  ])

  assert.match(globalScss, /--font-size-battle-result:\s*4rem/)
  assert.match(overlayScss, /\.battle-pre-screen__start\s*\{[\s\S]*border:\s*var\(--border-width\) solid var\(--color-highlight\)/)
  assert.match(overlayScss, /\.battle-result-screen\s*\{[\s\S]*position:\s*fixed[\s\S]*z-index:\s*30/)
  assert.match(overlayScss, /\.battle-result-screen\s*\{[\s\S]*background:\s*var\(--gray-2\)/)
  assert.match(overlayScss, /font-size:\s*var\(--font-size-battle-result\)/)
  assert.match(overlayScss, /\.battle-result-screen__main\s*\{[\s\S]*margin-inline:\s*auto[\s\S]*gap:\s*var\(--space-6\)/)
  assert.match(overlayScss, /\.battle-result-screen__heading\s*\{[\s\S]*font-weight:\s*800/)
  assert.match(overlayScss, /\.battle-result-screen__heading--win\s*\{[\s\S]*-webkit-text-stroke:\s*0\.04em var\(--gray-1\)/)
  assert.match(overlayScss, /\.battle-result-screen__heading--lose\s*\{[\s\S]*-webkit-text-stroke:\s*0\.025em var\(--gray-1\)/)
  assert.match(animationScss, /\.battle--cards-awaiting-entry \.battle__hand--user \.battle-animation-position\s*\{[\s\S]*translateY\(var\(--battle-card-entry-user-start-y\)\)/)
  assert.match(animationScss, /\.battle--cards-awaiting-entry \.battle__hand--enemy \.battle-animation-position\s*\{[\s\S]*translateY\(var\(--battle-card-entry-enemy-start-y\)\)/)
  assert.match(showView, /card_entry_start_ratio:/)
  assert.doesNotMatch(showView, /data-battle-pre-screen/)
  assert.doesNotMatch(debugView, /card_entry_start_ratio:/)
})
