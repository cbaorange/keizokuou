export const DECK_STORAGE_KEY = "deck"
export const EMPTY_LOCAL_DECK = Object.freeze([0, 0, 0, 0, 0])

export function localDeckIsValid(value) {
  return (
    Array.isArray(value) &&
    value.length === EMPTY_LOCAL_DECK.length &&
    value.every((cardId) => Number.isInteger(cardId) && cardId >= 0)
  )
}

export function readLocalDeck(storage) {
  if (storage === null || typeof storage?.getItem !== "function") {
    throw new TypeError("storageはgetItemを持つ必要があります")
  }

  const savedDeck = storage.getItem(DECK_STORAGE_KEY)
  if (savedDeck === null) return [...EMPTY_LOCAL_DECK]

  try {
    const parsedDeck = JSON.parse(savedDeck)
    return localDeckIsValid(parsedDeck) ? parsedDeck : [...EMPTY_LOCAL_DECK]
  } catch (_error) {
    return [...EMPTY_LOCAL_DECK]
  }
}

// 新規登録開始時に、既存と同じキー・配列構造で全5枠を空に戻す。
export function resetLocalDeck(storage) {
  if (storage === null || typeof storage?.setItem !== "function") {
    throw new TypeError("storageはsetItemを持つ必要があります")
  }

  try {
    storage.setItem(DECK_STORAGE_KEY, JSON.stringify(EMPTY_LOCAL_DECK))
    return true
  } catch (_error) {
    return false
  }
}

function deckSlotIsEmpty(cardId) {
  return (
    cardId === 0 ||
    cardId === "" ||
    cardId === null ||
    cardId === undefined
  )
}

function deckForAutoSet(value) {
  if (
    !Array.isArray(value) ||
    value.length !== EMPTY_LOCAL_DECK.length ||
    !value.every((cardId) => (
      deckSlotIsEmpty(cardId) ||
      (Number.isInteger(cardId) && cardId > 0)
    ))
  ) {
    return [...EMPTY_LOCAL_DECK]
  }

  return value.map((cardId) => deckSlotIsEmpty(cardId) ? 0 : cardId)
}

// 報酬カードが未参加で空欄がある場合だけ、表示順先頭の空欄へ追加する。
export function autoSetCardInLocalDeck(cardId, storage) {
  if (!Number.isInteger(cardId) || cardId <= 0) {
    return false
  }

  if (
    storage === null ||
    typeof storage?.getItem !== "function" ||
    typeof storage?.setItem !== "function"
  ) {
    throw new TypeError("storageはgetItemとsetItemを持つ必要があります")
  }

  let deck = [...EMPTY_LOCAL_DECK]

  try {
    const savedDeck = storage.getItem(DECK_STORAGE_KEY)

    if (savedDeck !== null) {
      deck = deckForAutoSet(JSON.parse(savedDeck))
    }
  } catch (_error) {
    deck = [...EMPTY_LOCAL_DECK]
  }

  if (deck.includes(cardId)) {
    return false
  }

  const emptySlotIndex = deck.indexOf(0)

  if (emptySlotIndex === -1) {
    return false
  }

  const updatedDeck = [...deck]

  updatedDeck[emptySlotIndex] = cardId

  try {
    storage.setItem(DECK_STORAGE_KEY, JSON.stringify(updatedDeck))
    return true
  } catch (_error) {
    return false
  }
}
