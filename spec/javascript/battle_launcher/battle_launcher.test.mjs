import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { readLocalDeck } from "../../../app/javascript/battle_deck_storage.js"
import {
  launcherDeckEntries,
  setupBattleLauncher,
  updateBattleLauncherStartState,
} from "../../../app/javascript/battle_launcher.js"

function createStartLink() {
  const classes = new Set(["battle-launcher-modal__start"])
  const label = { textContent: "" }
  return {
    dataset: { battleUrl: "/battle", cardsUrl: "/cards" },
    href: "",
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
      contains: (value) => classes.has(value),
    },
    querySelector: (selector) => selector === "[data-battle-launcher-start-label]" ? label : null,
    label,
  }
}

test("localStorageの生デッキ5枠を同じ順序で読み取る", () => {
  const storage = { getItem: (key) => key === "deck" ? "[7,0,1,99,3]" : null }

  assert.deepEqual(readLocalDeck(storage), [7, 0, 1, 99, 3])
})

test("未保存・不正デッキは保存せず5つの空欄として扱う", () => {
  let writes = 0
  const storage = {
    getItem: () => "[1]",
    setItem: () => { writes += 1 }
  }

  assert.deepEqual(readLocalDeck(storage), [0, 0, 0, 0, 0])
  assert.equal(writes, 0)
})

test("所有かつ画像情報があるカードだけを元スロットへ表示し、他はnullにする", () => {
  const entries = launcherDeckEntries({
    localDeck: [7, 0, 1, 99, 3],
    ownedCardIds: [1, 7, 99],
    portraitCards: {
      "1": { name: "一号", portraitUrl: "/portraits/1.png" },
      "7": { name: "七号", portraitUrl: "/portraits/7.png" }
    }
  })

  assert.deepEqual(entries.map((entry) => entry?.cardId ?? null), [7, null, 1, null, null])
})

test("有効カードが1体以上なら通常表示で新しいbattleへ進む", () => {
  const startLink = createStartLink()
  const state = updateBattleLauncherStartState({
    startLink,
    entries: [{ cardId: 7 }, null, null, null, null],
  })

  assert.deepEqual(state, { emptyDeck: false, targetUrl: "/battle" })
  assert.equal(startLink.label.textContent, "バトル開始")
  assert.equal(startLink.href, "/battle")
  assert.equal(startLink.dataset.emptyDeck, "false")
  assert.equal(startLink.classList.contains("battle-launcher-modal__start--empty"), false)
})

test("有効カードが0体なら案内表示でcardsへ進む", () => {
  const startLink = createStartLink()
  const state = updateBattleLauncherStartState({
    startLink,
    entries: [null, null, null, null, null],
  })

  assert.deepEqual(state, { emptyDeck: true, targetUrl: "/cards" })
  assert.equal(startLink.label.textContent, "デッキに一体以上のシュカモンを追加してください")
  assert.equal(startLink.href, "/cards")
  assert.equal(startLink.dataset.emptyDeck, "true")
  assert.equal(startLink.classList.contains("battle-launcher-modal__start--empty"), true)
})

test("localStorageを読み直すたびに空デッキ判定が更新される", () => {
  let storedDeck = "[0,0,0,0,0]"
  const storage = { getItem: () => storedDeck }
  const ownedCardIds = [7]
  const portraitCards = { "7": { name: "七号", portraitUrl: "/portraits/7.png" } }

  const emptyEntries = launcherDeckEntries({
    localDeck: readLocalDeck(storage),
    ownedCardIds,
    portraitCards,
  })
  storedDeck = "[0,0,7,0,0]"
  const populatedEntries = launcherDeckEntries({
    localDeck: readLocalDeck(storage),
    ownedCardIds,
    portraitCards,
  })

  assert.equal(emptyEntries.every((entry) => entry === null), true)
  assert.deepEqual(populatedEntries.map((entry) => entry?.cardId ?? null), [null, null, 7, null, null])
})

test("複数の起動ボタンから同じポップアップを開き、閉じると押したボタンへ戻る", () => {
  const listeners = new Map()
  const focusCounts = [0, 0]
  const openButtons = focusCounts.map((_, index) => ({
    addEventListener: (type, listener) => listeners.set(`open-${index}-${type}`, listener),
    focus: () => { focusCounts[index] += 1 },
  }))
  const portraits = Array.from({ length: 5 }, () => ({ hidden: false, src: "", alt: "" }))
  const startLink = createStartLink()
  startLink.addEventListener = (type, listener) => listeners.set(`start-${type}`, listener)
  startLink.focus = () => {}
  const closeButton = {}
  const modal = {}
  const layerClasses = new Set()
  const layer = {
    hidden: true,
    querySelector: (selector) => ({
      ".battle-launcher-modal": modal,
      "[data-battle-launcher-close]": closeButton,
      "[data-battle-launcher-start]": startLink,
    })[selector] ?? null,
    querySelectorAll: (selector) => selector === "[data-battle-launcher-portrait]" ? portraits : [],
    addEventListener: (type, listener) => listeners.set(`layer-${type}`, listener),
  }
  const root = {
    body: {
      classList: {
        add: (value) => layerClasses.add(value),
        remove: (value) => layerClasses.delete(value),
      },
    },
    querySelector: (selector) => selector === "[data-battle-launcher]" ? layer : null,
    querySelectorAll: (selector) => selector === "[data-battle-launcher-open]" ? openButtons : [],
    getElementById: (id) => id === "battle-launcher-data" ? {
      textContent: JSON.stringify({ displayRate: 0, ownedCardIds: [], portraitCards: {} }),
    } : null,
    addEventListener: (type, listener) => listeners.set(`root-${type}`, listener),
  }

  const launcher = setupBattleLauncher({
    root,
    storage: { getItem: () => null },
    locationRef: { assign: () => {} },
  })

  listeners.get("open-1-click")()
  assert.equal(layer.hidden, false)
  assert.equal(layerClasses.has("modal-open"), true)

  launcher.close()
  assert.equal(layer.hidden, true)
  assert.deepEqual(focusCounts, [0, 1])
})

test("ポップアップ専用SCSSは見出し、hover色、gradient、空デッキ表示を固定する", () => {
  const scss = readFileSync(
    new URL("../../../app/assets/stylesheets/layout/_battle_launcher.scss", import.meta.url),
    "utf8",
  )

  assert.match(scss, /\.battle-launcher-modal__start:hover[\s\S]*?color: var\(--color-text-primary\)/)
  assert.match(scss, /var\(--gray-3\) 52%/)
  assert.match(scss, /var\(--battle-bottun-red\) 100%/)
  assert.match(scss, /\.battle-launcher-modal__start--empty \{[\s\S]*?background: var\(--gray-3\)/)
  assert.match(scss, /\.battle-launcher-modal__start--empty \.battle-pre-screen__start-label \{[\s\S]*?font-size: var\(--font-size-body\)/)
  assert.match(scss, /\.battle-launcher-modal__deck \{[\s\S]*?padding: var\(--space-1\) 0 0/)
  assert.match(scss, /--battle-launcher-lower-min-height: 0/)
  assert.match(scss, /\.battle-launcher-modal__close \{[\s\S]*?min-height: var\(--battle-launcher-lower-min-height\)[\s\S]*?padding: 0[\s\S]*?line-height: 1/)
  assert.match(scss, /\.battle-launcher-modal__deck \{[\s\S]*?min-height: var\(--battle-launcher-lower-min-height\)[\s\S]*?gap: 0/)
  assert.match(scss, /\.battle-launcher-modal__deck-heading \{[\s\S]*?color: var\(--color-text-body\)[\s\S]*?font-size: var\(--font-size-caption\)/)
  assert.match(scss, /\.battle-launcher-modal__deck \.battle-pre-screen__deck-slot \{[\s\S]*?width: 100%[\s\S]*?aspect-ratio: 1/)
  assert.match(scss, /\.battle-launcher-modal__deck \.battle-pre-screen__portrait \{[\s\S]*?width: 100%[\s\S]*?max-width: none[\s\S]*?height: 100%[\s\S]*?margin-top: 0[\s\S]*?object-fit: contain/)
})
