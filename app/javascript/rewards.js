// YAML比率と実測幅から、フォルダ形状に必要な3つの寸法を算出する
export function calculateFolderGeometry(width, slopeStartRatio, tabHeightRatio) {
  const slopeStart = width * slopeStartRatio
  const tabHeight = width * tabHeightRatio

  return {
    slopeStart,
    tabHeight,
    slopeEnd: slopeStart + tabHeight,
  }
}

// ポップアップ幅を一覧フォルダ1個の実測幅から決定する
export function calculatePopupWidth(folderWidth) {
  return folderWidth * 2
}

// YAMLの高さ比率をフォルダ幅へ掛け、内容で超えられる最低高さを算出する
export function calculateFolderMinimumHeight(folderWidth, heightRatio) {
  return folderWidth * heightRatio
}

function createFolderPath(width, height, geometry, radius, borderWidth) {
  const inset = borderWidth / 2
  const left = inset
  const top = inset
  const right = width - inset
  const bottom = height - inset
  const bodyTop = geometry.tabHeight + inset
  const cornerRadius = Math.min(radius, width / 2, height / 2)

  return [
    `M ${left + cornerRadius} ${top}`,
    `L ${geometry.slopeStart} ${top}`,
    `L ${geometry.slopeEnd} ${bodyTop}`,
    `L ${right - cornerRadius} ${bodyTop}`,
    `Q ${right} ${bodyTop} ${right} ${bodyTop + cornerRadius}`,
    `L ${right} ${bottom - cornerRadius}`,
    `Q ${right} ${bottom} ${right - cornerRadius} ${bottom}`,
    `L ${left + cornerRadius} ${bottom}`,
    `Q ${left} ${bottom} ${left} ${bottom - cornerRadius}`,
    `L ${left} ${top + cornerRadius}`,
    `Q ${left} ${top} ${left + cornerRadius} ${top}`,
    "Z",
  ].join(" ")
}

function cssNumber(styles, propertyName) {
  const value = Number.parseFloat(styles.getPropertyValue(propertyName))

  if (!Number.isFinite(value)) {
    throw new Error(`${propertyName}が数値ではありません`)
  }

  return value
}

function shapeProperties(element) {
  if (element.matches("[data-reward-folder]")) {
    return {
      slope: "--reward-folder-slope-start-ratio",
      tab: "--reward-folder-tab-height-ratio",
      computedTab: "--reward-folder-tab-height",
    }
  }

  return {
    slope: "--reward-content-popup-slope-start-ratio",
    tab: "--reward-content-popup-tab-height-ratio",
    computedTab: "--reward-content-popup-tab-height",
  }
}

function updateFolderShape(element) {
  const shape = element.querySelector("[data-folder-shape-svg]")
  const outline = element.querySelector("[data-folder-shape-outline]")

  if (shape === null || outline === null) {
    throw new Error("報酬フォルダの形状要素が不足しています")
  }

  const width = element.clientWidth

  if (width === 0) {
    return
  }

  const properties = shapeProperties(element)
  const elementStyles = getComputedStyle(element)
  const rootStyles = getComputedStyle(document.documentElement)

  if (element.matches("[data-reward-folder]")) {
    const minimumHeight = calculateFolderMinimumHeight(
      width,
      cssNumber(elementStyles, "--reward-folder-height-ratio")
    )

    element.style.setProperty("--reward-folder-min-height", `${minimumHeight}px`)
  }

  const height = element.clientHeight

  if (height === 0) {
    return
  }

  const geometry = calculateFolderGeometry(
    width,
    cssNumber(elementStyles, properties.slope),
    cssNumber(elementStyles, properties.tab)
  )
  const radius = Number.parseFloat(elementStyles.borderRadius)
  const borderWidth = cssNumber(rootStyles, "--border-width")

  element.style.setProperty(properties.computedTab, `${geometry.tabHeight}px`)
  shape.setAttribute("viewBox", `0 0 ${width} ${height}`)
  outline.setAttribute(
    "d",
    createFolderPath(width, height, geometry, radius, borderWidth)
  )
}

function updatePopupWidths() {
  const folder = document.querySelector("[data-reward-folder]")

  if (folder === null) {
    return
  }

  const popupWidth = calculatePopupWidth(folder.getBoundingClientRect().width)

  document.querySelectorAll("[data-reward-content-popup]").forEach((popup) => {
    popup.style.width = `${popupWidth}px`
    updateFolderShape(popup)
  })
}

function closeRewardContent(layer) {
  const openerId = layer.dataset.rewardContentOpener
  const opener = typeof openerId === "string"
    ? document.getElementById(openerId)
    : null

  layer.hidden = true
  delete layer.dataset.rewardContentOpener
  document.body.classList.remove("modal-open")
  opener?.classList.remove("reward-folder--open")

  opener?.focus({ preventScroll: true })
}

function openRewardContent(folder, layer) {
  if (folder.dataset.rewardUnlocked !== "true") {
    return
  }

  if (folder.id === "") {
    folder.id = `reward-folder-opener-${layer.id}`
  }

  layer.dataset.rewardContentOpener = folder.id
  layer.hidden = false
  document.body.classList.add("modal-open")
  folder.classList.add("reward-folder--open")
  updatePopupWidths()

  const popup = layer.querySelector("[data-reward-content-popup]")

  if (popup !== null) {
    updateFolderShape(popup)
  }

  layer.querySelector("[data-reward-content-close]")?.focus({
    preventScroll: true,
  })
}

function setupRewardFolders() {
  const folders = document.querySelectorAll("[data-reward-folder]")

  folders.forEach((folder) => {
    folder.addEventListener("click", () => {
      if (folder.dataset.rewardUnlocked !== "true") {
        return
      }

      const popupId = folder.getAttribute("aria-controls")
      const layer = popupId === null ? null : document.getElementById(popupId)

      if (layer !== null) {
        openRewardContent(folder, layer)
      }
    })

    updateFolderShape(folder)
  })

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => {
      folders.forEach(updateFolderShape)
      updatePopupWidths()
    })

    folders.forEach((folder) => observer.observe(folder))
  } else {
    window.addEventListener("resize", () => {
      folders.forEach(updateFolderShape)
      updatePopupWidths()
    })
  }

  updatePopupWidths()
}

function setupRewardContentLayers() {
  document.querySelectorAll("[data-reward-content-layer]").forEach((layer) => {
    layer.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) {
        return
      }

      if (
        event.target === layer ||
        event.target.closest("[data-reward-content-close]") !== null
      ) {
        closeRewardContent(layer)
      }
    })
  })
}

if (typeof document !== "undefined") {
  setupRewardFolders()
  setupRewardContentLayers()
}
