import { readLocalDeck } from "./battle_deck_storage.js"

const BOOTSTRAP_ID = "battle-launcher-data"

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label}はオブジェクトである必要があります`)
  }
  return value
}

export function parseBattleLauncherData(root = document) {
  const element = root.getElementById(BOOTSTRAP_ID)
  if (element === null) throw new Error(`バトル開始データが見つかりません（#${BOOTSTRAP_ID}）`)

  const data = requireObject(JSON.parse(element.textContent), "バトル開始データ")
  if (!Number.isInteger(data.displayRate) || data.displayRate < 0) {
    throw new RangeError("表示レートは0以上の整数である必要があります")
  }
  if (!Array.isArray(data.ownedCardIds) || !data.ownedCardIds.every(Number.isInteger)) {
    throw new TypeError("ownedCardIdsは整数配列である必要があります")
  }
  requireObject(data.portraitCards, "portraitCards")
  return data
}

export function launcherDeckEntries({ localDeck, ownedCardIds, portraitCards }) {
  const ownedIds = new Set(ownedCardIds)
  return localDeck.map((cardId) => {
    const card = portraitCards[String(cardId)]
    if (cardId < 1 || !ownedIds.has(cardId) || card === undefined) return null
    if (typeof card.name !== "string" || typeof card.portraitUrl !== "string") {
      throw new Error(`カードID ${cardId} のポートレート情報が不正です`)
    }
    return { cardId, name: card.name, portraitUrl: card.portraitUrl }
  })
}

export function renderBattleLauncherDeck({ layer, storage, data }) {
  const portraitElements = [...layer.querySelectorAll("[data-battle-launcher-portrait]")]
  if (portraitElements.length !== 5) throw new Error("バトル開始デッキは5スロット必要です")

  const entries = launcherDeckEntries({
    localDeck: readLocalDeck(storage),
    ownedCardIds: data.ownedCardIds,
    portraitCards: data.portraitCards
  })
  portraitElements.forEach((portrait, index) => {
    const entry = entries[index]
    portrait.hidden = entry === null
    portrait.src = entry?.portraitUrl ?? ""
    portrait.alt = entry === null ? "" : `${entry.name}のポートレート`
  })
  return entries
}

export function updateBattleLauncherStartState({ startLink, entries }) {
  if (!Array.isArray(entries) || entries.length !== 5) {
    throw new TypeError("バトル開始デッキは5スロット必要です")
  }
  const label = startLink.querySelector("[data-battle-launcher-start-label]")
  if (label === null) throw new Error("バトル開始ラベルが見つかりません")

  const emptyDeck = entries.every((entry) => entry === null)
  const targetUrl = emptyDeck ? startLink.dataset.cardsUrl : startLink.dataset.battleUrl
  if (typeof targetUrl !== "string" || targetUrl.length === 0) {
    throw new Error("バトル開始ポップアップの遷移先URLがありません")
  }

  label.textContent = emptyDeck
    ? "デッキに一体以上のシュカモンを追加してください"
    : "バトル開始"
  startLink.href = targetUrl
  startLink.dataset.emptyDeck = String(emptyDeck)
  if (emptyDeck) {
    startLink.classList.add("battle-launcher-modal__start--empty")
  } else {
    startLink.classList.remove("battle-launcher-modal__start--empty")
  }
  return { emptyDeck, targetUrl }
}

export function setupBattleLauncher({
  root = document,
  storage = localStorage,
  locationRef = globalThis.location
} = {}) {
  const layer = root.querySelector("[data-battle-launcher]")
  const openButtons = [...root.querySelectorAll("[data-battle-launcher-open]")]
  if (layer === null && openButtons.length === 0) return null
  if (layer === null || openButtons.length === 0) throw new Error("バトル開始ポップアップDOMが不足しています")

  const modal = layer.querySelector(".battle-launcher-modal")
  const closeButton = layer.querySelector("[data-battle-launcher-close]")
  const startLink = layer.querySelector("[data-battle-launcher-start]")
  if (modal === null || closeButton === null || startLink === null) {
    throw new Error("バトル開始ポップアップの操作要素が不足しています")
  }
  if (typeof locationRef?.assign !== "function") throw new TypeError("locationRefはassignを持つ必要があります")
  const data = parseBattleLauncherData(root)
  let starting = false
  let activeOpenButton = openButtons[0]

  const close = () => {
    if (starting) return
    layer.hidden = true
    root.body.classList.remove("modal-open")
    activeOpenButton.focus?.({ preventScroll: true })
  }
  const open = (openButton = openButtons[0]) => {
    activeOpenButton = openButton
    const entries = renderBattleLauncherDeck({ layer, storage, data })
    updateBattleLauncherStartState({ startLink, entries })
    layer.hidden = false
    root.body.classList.add("modal-open")
    startLink.focus?.({ preventScroll: true })
  }
  const onLayerClick = (event) => {
    if (event.target === layer || event.target.closest?.("[data-battle-launcher-close]") !== null) close()
  }
  const onKeydown = (event) => {
    if (event.key === "Escape" && !layer.hidden) close()
  }
  const onStart = (event) => {
    event.preventDefault()
    if (starting) return
    starting = true
    layer.inert = true
    locationRef.assign(startLink.href)
  }

  openButtons.forEach((openButton) => {
    openButton.addEventListener("click", () => open(openButton))
  })
  layer.addEventListener("click", onLayerClick)
  root.addEventListener("keydown", onKeydown)
  startLink.addEventListener("click", onStart)

  return { open, close }
}

if (typeof document !== "undefined") {
  setupBattleLauncher()
}
