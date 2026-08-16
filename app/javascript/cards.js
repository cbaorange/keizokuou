const DECK_STORAGE_KEY = "deck"
const DECK_SLOT_COUNT = 5

function createEmptyDeck() {
  return Array(DECK_SLOT_COUNT).fill(0)
}

function deckDataIsValid(deck) {
  return Array.isArray(deck) &&
    deck.length === DECK_SLOT_COUNT &&
    deck.every((syukamonId) => (
      Number.isInteger(syukamonId) && syukamonId >= 0
    ))
}

function saveDeck(deck) {
  try {
    localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(deck))
    return true
  } catch (error) {
    console.error("デッキ情報を保存できませんでした", error)
    return false
  }
}

function loadDeck() {
  const emptyDeck = createEmptyDeck()

  try {
    const savedDeck = localStorage.getItem(DECK_STORAGE_KEY)

    if (savedDeck === null) {
      saveDeck(emptyDeck)
      return emptyDeck
    }

    const parsedDeck = JSON.parse(savedDeck)

    if (!deckDataIsValid(parsedDeck)) {
      saveDeck(emptyDeck)
      return emptyDeck
    }

    return parsedDeck
  } catch (error) {
    console.error("デッキ情報を読み取れませんでした", error)
    saveDeck(emptyDeck)
    return emptyDeck
  }
}

function loadOwnedCardIds(cardsPage) {
  try {
    const ownedCardIds = JSON.parse(cardsPage.dataset.ownedCardIds || "[]")

    if (
      !Array.isArray(ownedCardIds) ||
      !ownedCardIds.every((cardId) => (
        Number.isInteger(cardId) && cardId > 0
      ))
    ) {
      throw new Error("所有カードIDの形式が不正です")
    }

    return new Set(ownedCardIds)
  } catch (error) {
    console.error("所有カード情報を読み取れませんでした", error)
    return new Set()
  }
}

function buildSyukamonCatalog(cardElements, ownedCardIds) {
  const catalog = new Map()

  cardElements.forEach((cardElement) => {
    const syukamonId = Number(cardElement.dataset.syukamonId)

    if (
      !Number.isInteger(syukamonId) ||
      syukamonId <= 0 ||
      !ownedCardIds.has(syukamonId)
    ) {
      return
    }

    catalog.set(syukamonId, {
      id: syukamonId,
      name: cardElement.dataset.syukamonName || "",
      shortName: cardElement.dataset.syukamonShortName ||
        cardElement.dataset.syukamonName || "",
      cardImageUrl: cardElement.dataset.cardImageUrl || "",
      portraitImageUrl: cardElement.dataset.portraitImageUrl || "",
      detail: {
        name: cardElement.dataset.syukamonName || "",
        level: cardElement.dataset.syukamonDetailLevel || "",
        expToNextLevel: cardElement.dataset.syukamonDetailExpToNextLevel || "",
        type: cardElement.dataset.syukamonDetailType || "",
        attack: cardElement.dataset.syukamonDetailAttack || "",
        defense: cardElement.dataset.syukamonDetailDefense || "",
        speed: cardElement.dataset.syukamonDetailSpeed || "",
        buff: cardElement.dataset.syukamonDetailBuff || "",
        birthplace: cardElement.dataset.syukamonDetailBirthplace || "",
        expBonus: cardElement.dataset.syukamonDetailExpBonus || ""
      }
    })
  })

  return catalog
}

// 同じシュカモンが選ばれたことを、該当するデッキ枠の横揺れで知らせる。
function handleDuplicateDeckCard(syukamonId) {
  const deckSlot = document.querySelector(
    `.deck-slot[data-syukamon-id="${syukamonId}"]`
  )

  if (!(deckSlot instanceof HTMLElement)) {
    return
  }

  deckSlot.classList.remove("deck-slot--duplicate")

  // 連続して選択された場合も、アニメーションを最初から再開する。
  void deckSlot.offsetWidth

  deckSlot.classList.add("deck-slot--duplicate")
}

function initializeCardsPage() {
  const cardsPage = document.querySelector(".cards-page")

  if (cardsPage === null) {
    return
  }

  const cardElements = [...cardsPage.querySelectorAll(
    ".card-placeholder[data-syukamon-id]"
  )]
  const deckSlotElements = [...cardsPage.querySelectorAll(
    ".deck-slot[data-deck-slot-index]"
  )]
  const ownedCardIds = loadOwnedCardIds(cardsPage)
  const syukamonCatalog = buildSyukamonCatalog(cardElements, ownedCardIds)
  const warningElement = cardsPage.querySelector("[data-deck-full-warning]")
  const detailLayer = cardsPage.querySelector("[data-card-detail-layer]")
  const detailDialog = cardsPage.querySelector(".card-detail-dialog")
  const detailCloseButton = cardsPage.querySelector("[data-card-detail-close]")
  const detailImage = cardsPage.querySelector("[data-card-detail-image]")
  const detailElements = {
    name: cardsPage.querySelector("[data-card-detail-name]"),
    level: cardsPage.querySelector("[data-card-detail-level]"),
    expToNextLevel: cardsPage.querySelector(
      "[data-card-detail-exp-to-next-level]"
    ),
    type: cardsPage.querySelector("[data-card-detail-type]"),
    attack: cardsPage.querySelector("[data-card-detail-attack]"),
    defense: cardsPage.querySelector("[data-card-detail-defense]"),
    speed: cardsPage.querySelector("[data-card-detail-speed]"),
    buff: cardsPage.querySelector("[data-card-detail-buff]"),
    birthplace: cardsPage.querySelector("[data-card-detail-birthplace]"),
    expBonus: cardsPage.querySelector("[data-card-detail-exp-bonus]")
  }

  let deck = loadDeck()
  let lastDetailButton = null

  // 未所持または現在のカード一覧に存在しないIDだけを、同じ枠位置の0へ戻す。
  const normalizedDeck = deck.map((syukamonId) => (
    syukamonId === 0 || (
      ownedCardIds.has(syukamonId) && syukamonCatalog.has(syukamonId)
    ) ? syukamonId : 0
  ))

  if (normalizedDeck.some((syukamonId, index) => syukamonId !== deck[index])) {
    deck = normalizedDeck
    saveDeck(deck)
  }

  function renderDeck() {
    deckSlotElements.forEach((slotElement) => {
      const slotIndex = Number(slotElement.dataset.deckSlotIndex)
      const syukamonId = deck[slotIndex] || 0
      const syukamon = syukamonCatalog.get(syukamonId)
      const portraitElement = slotElement.querySelector("[data-deck-portrait]")
      const detailsElement = slotElement.querySelector("[data-deck-details]")
      const nameElement = slotElement.querySelector("[data-deck-name]")
      const removeButton = slotElement.querySelector("[data-deck-remove-button]")
      const slotNumber = slotIndex + 1

      slotElement.classList.toggle("deck-slot--empty", syukamon === undefined)
      slotElement.dataset.syukamonId = syukamon ? String(syukamon.id) : "0"

      if (syukamon === undefined) {
        slotElement.setAttribute("aria-label", `デッキ枠${slotNumber}、空き`)

        if (portraitElement instanceof HTMLImageElement) {
          portraitElement.hidden = true
          portraitElement.removeAttribute("src")
          portraitElement.alt = ""
        }

        if (detailsElement instanceof HTMLElement) {
          detailsElement.hidden = true
        }

        if (nameElement !== null) {
          nameElement.textContent = ""
        }

        if (removeButton instanceof HTMLButtonElement) {
          removeButton.hidden = true
        }

        return
      }

      slotElement.setAttribute(
        "aria-label",
        `デッキ枠${slotNumber}、${syukamon.name}`
      )

      if (portraitElement instanceof HTMLImageElement) {
        portraitElement.src = syukamon.portraitImageUrl
        portraitElement.alt = `${syukamon.name}の立ち絵`
        portraitElement.hidden = false
      }

      if (detailsElement instanceof HTMLElement) {
        detailsElement.hidden = false
      }

      if (nameElement !== null) {
        nameElement.textContent = syukamon.shortName
      }

      if (removeButton instanceof HTMLButtonElement) {
        removeButton.hidden = false
        removeButton.setAttribute(
          "aria-label",
          `デッキ枠${slotNumber}から${syukamon.name}を外す`
        )
      }
    })
  }

  function showDeckFullWarning(cardElement) {
    if (!(warningElement instanceof HTMLElement)) {
      return
    }

    const cardCatalogPanel = warningElement.closest(".card-catalog-panel")

    if (
      cardElement instanceof HTMLElement &&
      cardCatalogPanel instanceof HTMLElement
    ) {
      const cardRect = cardElement.getBoundingClientRect()
      const panelRect = cardCatalogPanel.getBoundingClientRect()

      warningElement.style.setProperty(
        "--deck-full-warning-left",
        `${cardRect.left - panelRect.left + cardRect.width / 2}px`
      )
      warningElement.style.setProperty(
        "--deck-full-warning-top",
        `${cardRect.top - panelRect.top + cardRect.height / 2}px`
      )
    }

    warningElement.hidden = false
    warningElement.classList.remove("deck-full-warning--visible")

    // 同じ警告を連続表示した場合も、8秒のアニメーションを最初から再開する。
    void warningElement.offsetWidth

    warningElement.classList.add("deck-full-warning--visible")
  }

  function addSyukamonToDeck(syukamonId, cardElement) {
    if (!ownedCardIds.has(syukamonId) || !syukamonCatalog.has(syukamonId)) {
      return
    }

    // 満杯判定より先に重複を確認する。
    if (deck.includes(syukamonId)) {
      handleDuplicateDeckCard(syukamonId)
      return
    }

    const emptySlotIndex = deck.indexOf(0)

    if (emptySlotIndex === -1) {
      showDeckFullWarning(cardElement)
      return
    }

    deck[emptySlotIndex] = syukamonId
    saveDeck(deck)
    renderDeck()
  }

  function removeSyukamonFromDeck(slotIndex) {
    if (!Number.isInteger(slotIndex) || deck[slotIndex] === 0) {
      return
    }

    deck[slotIndex] = 0
    saveDeck(deck)
    renderDeck()
  }

  function openCardDetail(syukamonId, detailButton) {
    const syukamon = syukamonCatalog.get(syukamonId)

    if (
      !ownedCardIds.has(syukamonId) ||
      syukamon === undefined ||
      !(detailLayer instanceof HTMLElement) ||
      Object.values(detailElements).some((element) => element === null) ||
      !(detailImage instanceof HTMLImageElement)
    ) {
      return
    }

    Object.entries(syukamon.detail).forEach(([field, value]) => {
      detailElements[field].textContent = value
    })
    detailImage.src = syukamon.cardImageUrl
    detailImage.alt = `${syukamon.name}のカード`
    detailImage.hidden = false
    detailLayer.hidden = false
    document.body.classList.add("modal-open")
    lastDetailButton = detailButton

    if (detailCloseButton instanceof HTMLButtonElement) {
      detailCloseButton.focus()
    }
  }

  function closeCardDetail() {
    if (!(detailLayer instanceof HTMLElement)) {
      return
    }

    detailLayer.hidden = true
    document.body.classList.remove("modal-open")

    if (detailImage instanceof HTMLImageElement) {
      detailImage.hidden = true
      detailImage.removeAttribute("src")
      detailImage.alt = ""
    }

    Object.values(detailElements).forEach((element) => {
      if (element !== null) {
        element.textContent = ""
      }
    })

    if (lastDetailButton instanceof HTMLButtonElement) {
      lastDetailButton.focus()
    }

    lastDetailButton = null
  }

  if (warningElement instanceof HTMLElement) {
    warningElement.addEventListener("animationend", () => {
      warningElement.hidden = true
      warningElement.classList.remove("deck-full-warning--visible")
    })
  }

  cardsPage.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return
    }

    const detailButton = event.target.closest("[data-card-detail-button]")

    if (detailButton instanceof HTMLButtonElement) {
      event.stopPropagation()

      const cardElement = detailButton.closest("[data-syukamon-id]")
      const syukamonId = Number(cardElement?.dataset.syukamonId)

      openCardDetail(syukamonId, detailButton)
      return
    }

    const removeButton = event.target.closest("[data-deck-remove-button]")

    if (removeButton instanceof HTMLButtonElement) {
      event.stopPropagation()

      const slotElement = removeButton.closest("[data-deck-slot-index]")
      const slotIndex = Number(slotElement?.dataset.deckSlotIndex)

      removeSyukamonFromDeck(slotIndex)
      return
    }

    const addButton = event.target.closest("[data-deck-add-button]")

    if (addButton instanceof HTMLButtonElement) {
      const cardElement = addButton.closest(
        ".card-placeholder[data-syukamon-id]"
      )

      if (!(cardElement instanceof HTMLElement)) {
        return
      }

      addSyukamonToDeck(Number(cardElement.dataset.syukamonId), cardElement)
    }
  })

  cardsPage.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && detailLayer?.hidden === false) {
      closeCardDetail()
    }
  })

  cardsPage.addEventListener("animationend", (event) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.classList.contains("deck-slot--duplicate")
    ) {
      event.target.classList.remove("deck-slot--duplicate")
    }
  })

  if (detailLayer instanceof HTMLElement) {
    detailLayer.addEventListener("click", (event) => {
      if (event.target === detailLayer) {
        closeCardDetail()
      }
    })
  }

  if (detailCloseButton instanceof HTMLButtonElement) {
    detailCloseButton.addEventListener("click", (event) => {
      event.stopPropagation()
      closeCardDetail()
    })
  }

  if (detailDialog instanceof HTMLElement) {
    detailDialog.addEventListener("click", (event) => {
      event.stopPropagation()
    })
  }

  renderDeck()
}

try {
  initializeCardsPage()
} catch (error) {
  console.error("カードページの初期化に失敗しました", error)
}
