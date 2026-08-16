import {
  nicknameForDialogue,
  replaceNicknamePlaceholder,
  saveNickname
} from "./nickname_dialogue.js"
import { autoSetCardInLocalDeck } from "./battle_deck_storage.js"

const TASK_STORAGE_KEY = "keizokuou_daily_tasks"
const TASK_POSITIONS = ["1", "2", "3"]
const dialogueTypingControllers = new WeakMap()

let cardRewardModalOnClosed = null
let cardRewardAnimationRunId = 0
let tasksPagePreparationController = null

// 認証成功後にサーバーから一度だけ渡されたニックネームを保存する
function saveSubmittedNickname(appContent) {
  if (!appContent.hasAttribute("data-nickname-to-store")) {
    return
  }

  saveNickname(localStorage, appContent.dataset.nicknameToStore ?? "")
}

function requireDuration(value, path, allowZero = false) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (allowZero ? value < 0 : value <= 0)
  ) {
    const range = allowZero ? "0以上" : "0より大きい"

    throw new Error(`${path}は${range}数値である必要があります`)
  }

  return value
}

function loadTaskEffectsConfig() {
  const configElement = document.querySelector("#task-effects-config")

  if (configElement === null) {
    throw new Error("task.ymlの演出設定を取得できません")
  }

  const taskEffects = JSON.parse(
    configElement.textContent ?? ""
  )?.task_effects
  const characterIntervalMs = requireDuration(
    taskEffects?.dialogue_typing?.character_interval_ms,
    "task_effects.dialogue_typing.character_interval_ms"
  )
  const cardDropDurationMs = requireDuration(
    taskEffects?.syukamon_get?.card_drop?.duration_ms,
    "task_effects.syukamon_get.card_drop.duration_ms"
  )
  const cardFlipDelayMs = requireDuration(
    taskEffects?.syukamon_get?.card_flip?.delay_ms,
    "task_effects.syukamon_get.card_flip.delay_ms",
    true
  )
  const cardFlipDurationMs = requireDuration(
    taskEffects?.syukamon_get?.card_flip?.duration_ms,
    "task_effects.syukamon_get.card_flip.duration_ms"
  )
  const cardFlipDirection = taskEffects?.syukamon_get?.card_flip?.direction

  if (cardFlipDirection !== "left_side_forward") {
    throw new Error(
      "task_effects.syukamon_get.card_flip.directionが不正です"
    )
  }

  return {
    characterIntervalMs: characterIntervalMs,
    cardDropDurationMs: cardDropDurationMs,
    cardFlipDelayMs: cardFlipDelayMs,
    cardFlipDurationMs: cardFlipDurationMs,
    cardFlipDirection: cardFlipDirection
  }
}

function waitForDuration(durationMs, signal = null) {
  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(resolve, durationMs)

    signal?.addEventListener("abort", () => {
      window.clearTimeout(timeoutId)
      resolve()
    }, { once: true })
  })
}

function nextAnimationFrame(signal = null) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false)
      return
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      signal?.removeEventListener("abort", handleAbort)
      resolve(true)
    })
    const handleAbort = () => {
      window.cancelAnimationFrame(animationFrameId)
      resolve(false)
    }

    signal?.addEventListener("abort", handleAbort, { once: true })
  })
}

function setDialogueMeasure(message, dialogue) {
  const measure = message.closest("[data-dialogue-text-stack]")?.querySelector(
    "[data-dialogue-text-measure]"
  )

  if (measure === null || measure === undefined) {
    throw new Error("セリフの高さ確保要素を取得できません")
  }

  measure.textContent = dialogue
}

// 同じ要素で進行中の文字送りを中止してから、新しい全文を先頭から表示する。
async function typeDialogue(message, dialogue, characterIntervalMs) {
  dialogueTypingControllers.get(message)?.abort()

  const controller = new AbortController()
  const characters = Array.from(dialogue)

  dialogueTypingControllers.set(message, controller)
  setDialogueMeasure(message, dialogue)
  message.textContent = ""
  message.hidden = false

  for (let index = 0; index < characters.length; index += 1) {
    if (controller.signal.aborted) {
      return false
    }

    message.textContent += characters[index]

    if (index < characters.length - 1) {
      await waitForDuration(characterIntervalMs, controller.signal)
    }
  }

  if (dialogueTypingControllers.get(message) === controller) {
    dialogueTypingControllers.delete(message)
  }

  return true
}

function stopSyukamonDialogueTyping() {
  const message = document.querySelector("[data-syukamon-message]")

  if (message !== null) {
    dialogueTypingControllers.get(message)?.abort()
  }
}

// --- 事前準備処理ここから ---

function prepareSyukamonDialogue(type) {
  const panel = document.querySelector("[data-syukamon-panel]")
  const message = panel?.querySelector("[data-syukamon-message]")

  if (panel === null || panel === undefined || message === null) {
    return null
  }

  try {
    const dialogues = JSON.parse(panel.dataset.dialogues ?? "")
    const dialogue = dialogues?.[type]

    if (typeof dialogue !== "string" || dialogue.trim() === "") {
      throw new Error(`セリフ種別${type}を取得できません`)
    }

    const replacedDialogue = replaceNicknamePlaceholder(
      dialogue.trim(),
      nicknameForDialogue(localStorage)
    )

    setDialogueMeasure(message, replacedDialogue)

    return {
      dialogue: replacedDialogue,
      message: message
    }
  } catch (error) {
    console.error("シュカモンのセリフを準備できませんでした", error)
    return null
  }
}

// portraitの読み込み成否にかかわらず、描画準備が終了した時点で先へ進む。
async function waitForImageDecode(image) {
  if (!(image instanceof HTMLImageElement)) {
    return
  }

  if (typeof image.decode === "function") {
    try {
      await image.decode()
    } catch (_error) {
      // 読み込み失敗時もページ全体を待機させない。
    }

    return
  }

  if (image.complete) {
    return
  }

  await new Promise((resolve) => {
    const finish = () => {
      image.removeEventListener("load", finish)
      image.removeEventListener("error", finish)
      resolve()
    }

    image.addEventListener("load", finish, { once: true })
    image.addEventListener("error", finish, { once: true })
  })
}

// 初期演出を開始せず、全文・portrait・レイアウト・0文字paintだけを準備する。
async function prepareTasksPage(dialogueType, signal) {
  const preparedDialogue = prepareSyukamonDialogue(dialogueType)
  const portrait = document.querySelector(
    "[data-syukamon-panel] .test-syukamon-portrait"
  )

  if (preparedDialogue === null) {
    return null
  }

  dialogueTypingControllers.get(preparedDialogue.message)?.abort()
  preparedDialogue.message.textContent = ""
  preparedDialogue.message.hidden = false

  await waitForImageDecode(portrait)

  if (signal.aborted || !await nextAnimationFrame(signal)) {
    return null
  }

  // 1回目のframe後に0文字状態をpaintさせ、次frameから演出を開始する。
  if (!await nextAnimationFrame(signal)) {
    return null
  }

  return preparedDialogue
}

// --- 事前準備処理ここまで ---

function showSyukamonDialogue(type, taskEffectsConfig) {
  const preparedDialogue = prepareSyukamonDialogue(type)

  if (preparedDialogue === null) {
    return false
  }

  return typeDialogue(
    preparedDialogue.message,
    preparedDialogue.dialogue,
    taskEffectsConfig.characterIntervalMs
  )
}

function stopTasksPageEffects() {
  tasksPagePreparationController?.abort()

  document.querySelectorAll(
    "[data-syukamon-message], [data-card-reward-message]"
  ).forEach((message) => {
    dialogueTypingControllers.get(message)?.abort()
  })

  cardRewardAnimationRunId += 1
}

function initializeSyukamonDialogue() {
  const panel = document.querySelector("[data-syukamon-panel]")

  if (panel === null) {
    return { todayCompleted: false }
  }

  const todayCompleted = panel.dataset.todayCompleted === "true"
  const previousDayCompleted = panel.dataset.previousDayCompleted === "true"
  const hasPriorCompletion = panel.dataset.hasPriorCompletion === "true"
  const type = todayCompleted
    ? "done"
    : (previousDayCompleted || !hasPriorCompletion ? "todo" : "miss")

  return {
    dialogueType: type,
    todayCompleted: todayCompleted
  }
}

// 達成API成功後だけ、バックエンド由来の初期カレンダーを画面上で一度更新する
function updateCalendarAfterTaskCompletion() {
  const calendar = document.querySelector("[data-calendar-panel]")
  const today = calendar?.querySelector("[data-calendar-today]")
  const streak = calendar?.querySelector("[data-calendar-streak]")

  if (
    calendar === null ||
    calendar === undefined ||
    today === null ||
    streak === null ||
    calendar.dataset.todayCompleted === "true" ||
    calendar.dataset.calendarUpdated === "true" ||
    today.classList.contains("calendar-panel__day--completed")
  ) {
    return false
  }

  const currentStreak = Number.parseInt(streak.textContent ?? "", 10)

  if (!Number.isInteger(currentStreak) || currentStreak < 0) {
    console.error("連続達成日数を更新できませんでした")
    return false
  }

  streak.textContent = String(currentStreak + 1)
  today.classList.add("calendar-panel__day--completed")
  calendar.dataset.todayCompleted = "true"
  calendar.dataset.calendarUpdated = "true"

  return true
}

// localStorage保存用関数
function saveTaskStates(offsetDate, taskStates) {
  localStorage.setItem(
    TASK_STORAGE_KEY,
    JSON.stringify({
      updatedDate: offsetDate,
      tasks: taskStates
    })
  )
}

// 日付変更時はタスク内容を残し、達成状態だけを未達成へ戻す関数
function resetTaskCompletions(taskStates) {
  return Object.fromEntries(
    Object.entries(taskStates).map(([taskId, taskState]) => [
      taskId,
      updateTaskCompletion(taskState, false)
    ])
  )
}

// localStorage読み取り用関数
function loadTaskStates(offsetDate) {
  const savedTaskData = localStorage.getItem(TASK_STORAGE_KEY)

  if (savedTaskData === null) {
    const taskStates = {}
    saveTaskStates(offsetDate, taskStates)

    return taskStates
  }

  try {
    const parsedTaskData = JSON.parse(savedTaskData)
    const isValidTaskData = (
      parsedTaskData !== null &&
      typeof parsedTaskData === "object" &&
      !Array.isArray(parsedTaskData) &&
      typeof parsedTaskData.updatedDate === "string" &&
      parsedTaskData.tasks !== null &&
      typeof parsedTaskData.tasks === "object" &&
      !Array.isArray(parsedTaskData.tasks)
    )

    if (isValidTaskData) {
      if (parsedTaskData.updatedDate === offsetDate) {
        return parsedTaskData.tasks
      }

      const taskStates = resetTaskCompletions(parsedTaskData.tasks)
      saveTaskStates(offsetDate, taskStates)

      return taskStates
    }
  } catch (error) {
    console.error("タスク状態の保存データを解析できませんでした", error)
  }

  const taskStates = {}
  saveTaskStates(offsetDate, taskStates)

  return taskStates
}

// 従来の真偽値と、内容を持つタスク状態の両方から達成状態を取得する関数
function taskIsCompleted(taskState) {
  if (
    taskState !== null &&
    typeof taskState === "object" &&
    !Array.isArray(taskState)
  ) {
    return taskState.completed === true
  }

  return taskState === true
}

// タスク内容を保持したまま達成状態だけを更新する関数
function updateTaskCompletion(taskState, completed) {
  if (
    taskState !== null &&
    typeof taskState === "object" &&
    !Array.isArray(taskState)
  ) {
    return {
      ...taskState,
      completed: completed
    }
  }

  return completed
}

// 内容を持たない従来形式では、画面に埋め込まれた既存内容を引き継ぐ。
function taskContent(taskState, taskId) {
  const taskElement = document.querySelector(
    `.task-item[data-task-id="${taskId}"]`
  )
  const renderedJob = taskElement?.querySelector(
    ".task-item__title"
  )?.textContent ?? ""
  const renderedDescription = taskElement?.querySelector(
    ".task-item__description"
  )?.textContent ?? ""

  if (
    taskState !== null &&
    typeof taskState === "object" &&
    !Array.isArray(taskState)
  ) {
    return {
      job: typeof taskState.job === "string" ? taskState.job : renderedJob,
      description: typeof taskState.description === "string"
        ? taskState.description
        : renderedDescription
    }
  }

  return {
    job: renderedJob,
    description: renderedDescription
  }
}

function taskHasJob(taskState, taskId) {
  return taskContent(taskState, taskId).job.trim() !== ""
}

// 認証成功後に渡された内容だけをタスク1へ反映する関数
function applyTaskSetup(taskStates, job, description) {
  if (typeof job !== "string" || job.trim() === "") {
    return false
  }

  const currentTask = taskStates["1"]

  taskStates["1"] = {
    completed: taskIsCompleted(currentTask),
    job: job,
    description: typeof description === "string" ? description : ""
  }

  return true
}

// ページを訪れた時に発動する関数
function restoreTaskStates(taskStates) {
  const taskElements = document.querySelectorAll(
    ".task-item[data-task-id]"
  )

  taskElements.forEach((taskElement) => {
    const taskId = taskElement.dataset.taskId
    const taskState = taskStates[taskId]
    const completed = taskIsCompleted(taskState)
    const content = taskContent(taskState, taskId)

    taskElement.classList.toggle(
      "task-item--completed",
      completed
    )

    const checkElement = taskElement.querySelector(".task-item__check")

    if (checkElement !== null) {
      checkElement.toggleAttribute("hidden", !completed)
    }

    const titleElement = taskElement.querySelector(".task-item__title")
    const descriptionElement = taskElement.querySelector(
      ".task-item__description"
    )

    if (titleElement !== null) {
      titleElement.textContent = content.job
    }

    if (descriptionElement !== null) {
      descriptionElement.textContent = content.description
    }

    taskElement.hidden = content.job.trim() === ""
  })

  const orderedTaskElements = [
    ...[...taskElements].filter((taskElement) => !taskElement.hidden),
    ...[...taskElements].filter((taskElement) => taskElement.hidden)
  ]

  orderedTaskElements.forEach((taskElement, index) => {
    // positionはdata属性に残し、CSS Grid上の表示順だけを上へ詰める。
    taskElement.style.order = String(index + 1)
  })
}

// すべてのタスクが完了しているかを判定する関数
function areAllTasksCompleted(taskStates) {
  const taskElements = document.querySelectorAll(
    ".task-list .task-item[data-task-id]"
  )

  const activeTaskElements = [...taskElements].filter((taskElement) => {
    const taskId = taskElement.dataset.taskId

    return taskHasJob(taskStates[taskId], taskId)
  })

  if (activeTaskElements.length === 0) {
    return false
  }

  return activeTaskElements.every((taskElement) => {
    const taskId = taskElement.dataset.taskId

    return taskIsCompleted(taskStates[taskId])
  })
}

// 全達成時、コンフィムがいいえなら、最後にクリックしたタスクを未達成へ戻す関数
function revertTaskToIncomplete(
  taskElement,
  taskStates,
  taskId,
  offsetDate
) {
  taskStates[taskId] = updateTaskCompletion(taskStates[taskId], false)

  saveTaskStates(offsetDate, taskStates)

  taskElement.classList.remove("task-item--completed")

  const checkElement = taskElement.querySelector(".task-item__check")

  if (checkElement !== null) {
    checkElement.setAttribute("hidden", "")
  }
}

// 本日の達成後にオーバーレイを表示し、タスク一覧を操作不能にする関数
function lockCompletedTaskList() {
  const taskListContainer = document.querySelector(
    ".task-list-container"
  )

  if (taskListContainer === null) {
    return
  }

  const taskList = taskListContainer.querySelector(".task-list")
  const lockOverlay = taskListContainer.querySelector(
    ".task-completion-lock"
  )

  if (taskList === null || lockOverlay === null) {
    return
  }

  lockOverlay.hidden = false
  taskListContainer.classList.add("task-list-container--locked")
  taskList.setAttribute("aria-disabled", "true")
}

function unlockCompletedTaskList() {
  const taskListContainer = document.querySelector(
    ".task-list-container"
  )
  const taskList = taskListContainer?.querySelector(".task-list")
  const lockOverlay = taskListContainer?.querySelector(
    ".task-completion-lock"
  )

  if (
    taskListContainer === null ||
    taskListContainer === undefined ||
    taskList === null ||
    taskList === undefined ||
    lockOverlay === null ||
    lockOverlay === undefined
  ) {
    return
  }

  lockOverlay.hidden = true
  taskListContainer.classList.remove("task-list-container--locked")
  taskList.removeAttribute("aria-disabled")
}

// バックエンドの成功レスポンスを画面表示用データへ変換する関数
function buildCardRewardData(result) {
  const card = result?.card
  const expBreakdown = result?.exp_breakdown

  if (
    card === null ||
    typeof card !== "object" ||
    expBreakdown === null ||
    typeof expBreakdown !== "object" ||
    typeof card.name !== "string" ||
    typeof card.image !== "string" ||
    !Number.isInteger(card.id) ||
    card.id <= 0 ||
    !Number.isFinite(card.gained_exp) ||
    !Number.isFinite(expBreakdown.acquisition) ||
    !Number.isFinite(expBreakdown.streak)
  ) {
    console.error("カード報酬のレスポンス形式が不正です", result)
    return null
  }

  const experienceSources = [
    {
      label: "カード獲得",
      value: expBreakdown.acquisition
    },
    {
      label: "継続日数ボーナス",
      value: expBreakdown.streak
    }
  ]
  const buffs = Array.isArray(expBreakdown.buffs)
    ? expBreakdown.buffs
    : []

  buffs.forEach((buff) => {
    if (typeof buff?.name !== "string" || !Number.isFinite(buff.exp)) {
      return
    }

    experienceSources.push({
      label: buff.name,
      value: buff.exp
    })
  })

  const hasLevelUp = (
    card.level_up === true &&
    Number.isFinite(card.previous_level) &&
    Number.isFinite(card.current_level)
  )

  return {
    cardId: card.id,
    isNew: card.is_new === true,
    title: card.is_new === true
      ? "新しいカードを獲得しました！"
      : "カードが成長しました！",
    cardName: card.name,
    cardImagePath: card.image,
    message: typeof card.message === "string" ? card.message : "",
    levelChange: hasLevelUp
      ? `Lv${card.previous_level} → Lv${card.current_level}`
      : null,
    experienceSources: experienceSources,
    totalExperience: card.gained_exp,
    showExperience: true
  }
}

function setCardRewardRevealState(modalLayer, revealed) {
  modalLayer.querySelectorAll("[data-card-reward-reveal]").forEach(
    (element) => {
      element.classList.toggle(
        "card-reward-modal__reveal--hidden",
        !revealed
      )

      if (revealed) {
        element.removeAttribute("aria-hidden")
      } else {
        element.setAttribute("aria-hidden", "true")
      }
    }
  )
}

function setCardRewardCloseLocked(modalLayer, locked) {
  const closeButton = modalLayer.querySelector("[data-card-reward-close]")

  modalLayer.toggleAttribute("data-card-reward-close-locked", locked)

  if (closeButton instanceof HTMLButtonElement) {
    closeButton.disabled = locked
  }
}

async function playCardRewardAnimation(
  modalLayer,
  card,
  flipper,
  message,
  dialogue,
  taskEffectsConfig,
  runId
) {
  try {
    await nextAnimationFrame()

    if (runId !== cardRewardAnimationRunId) {
      return
    }

    const cardRect = card.getBoundingClientRect()
    const startTranslateY = -(cardRect.bottom + cardRect.height)

    card.style.transform = `translateY(${startTranslateY}px)`
    card.style.visibility = "visible"

    await nextAnimationFrame()

    const dropAnimation = card.animate(
      [
        { transform: `translateY(${startTranslateY}px)` },
        { transform: "translateY(0)" }
      ],
      {
        duration: taskEffectsConfig.cardDropDurationMs,
        easing: "linear",
        fill: "both"
      }
    )

    await dropAnimation.finished
    card.style.transform = "translateY(0)"
    dropAnimation.cancel()

    await waitForDuration(taskEffectsConfig.cardFlipDelayMs)

    if (runId !== cardRewardAnimationRunId) {
      return
    }

    const flipAngles = (
      taskEffectsConfig.cardFlipDirection === "left_side_forward"
        ? ["rotateY(180deg)", "rotateY(0deg)"]
        : []
    )
    const flipAnimation = flipper.animate(
      flipAngles.map((transform) => ({ transform: transform })),
      {
        duration: taskEffectsConfig.cardFlipDurationMs,
        easing: "linear",
        fill: "both"
      }
    )

    await flipAnimation.finished
    flipper.style.transform = "rotateY(0deg)"
    flipAnimation.cancel()
  } catch (error) {
    console.error("カード獲得演出を再生できませんでした", error)
  }

  if (runId !== cardRewardAnimationRunId) {
    return
  }

  card.style.visibility = "visible"
  card.style.transform = "translateY(0)"
  flipper.style.transform = "rotateY(0deg)"
  setCardRewardRevealState(modalLayer, true)
  setCardRewardCloseLocked(modalLayer, false)
  modalLayer.querySelector("[data-card-reward-close]")?.focus({
    preventScroll: true
  })

  await typeDialogue(
    message,
    dialogue,
    taskEffectsConfig.characterIntervalMs
  )
}

// 獲得したシュカモンと経験値をポップアップへ反映する関数
function openCardRewardModal(
  rewardData,
  taskEffectsConfig,
  onClosed = null
) {
  autoSetCardInLocalDeck(rewardData.cardId, localStorage)

  const modalLayer = document.querySelector("[data-card-reward-modal]")

  if (modalLayer === null) {
    return false
  }

  const card = modalLayer.querySelector(".card-reward-modal__card")
  const flipper = modalLayer.querySelector("[data-card-reward-flipper]")
  const cardImage = modalLayer.querySelector("[data-card-reward-image]")
  const cardName = modalLayer.querySelector("[data-card-reward-name]")
  const newBadge = modalLayer.querySelector("[data-card-reward-new]")
  const heading = modalLayer.querySelector("[data-card-reward-heading]")
  const headingSpacer = modalLayer.querySelector(
    "[data-card-reward-heading-spacer]"
  )
  const message = modalLayer.querySelector("[data-card-reward-message]")
  const levelChange = modalLayer.querySelector(
    "[data-card-reward-level-change]"
  )
  const experienceSources = modalLayer.querySelector(
    "[data-card-reward-experience-sources]"
  )
  const experienceSection = modalLayer.querySelector(
    "[data-card-reward-experience]"
  )
  const experienceTemplate = modalLayer.querySelector(
    "[data-card-reward-experience-template]"
  )
  const totalExperience = modalLayer.querySelector(
    "[data-card-reward-total-experience]"
  )
  const closeButton = modalLayer.querySelector("[data-card-reward-close]")

  if (
    cardImage === null ||
    cardName === null ||
    newBadge === null ||
    heading === null ||
    headingSpacer === null ||
    message === null ||
    levelChange === null ||
    experienceSection === null ||
    experienceSources === null ||
    experienceTemplate === null ||
    totalExperience === null ||
    card === null ||
    flipper === null ||
    closeButton === null
  ) {
    return false
  }

  const dialogue = replaceNicknamePlaceholder(
    rewardData.message,
    nicknameForDialogue(localStorage)
  )

  setDialogueMeasure(message, dialogue)
  stopSyukamonDialogueTyping()
  cardRewardAnimationRunId += 1
  cardRewardModalOnClosed = onClosed
  setCardRewardRevealState(modalLayer, false)
  setCardRewardCloseLocked(modalLayer, true)
  card.style.visibility = "hidden"
  card.style.transform = ""
  flipper.style.transform = "rotateY(180deg)"
  cardImage.src = rewardData.cardImagePath
  cardImage.alt = rewardData.cardName
  cardName.textContent = rewardData.cardName
  newBadge.hidden = rewardData.isNew !== true
  heading.textContent = rewardData.title
  headingSpacer.textContent = rewardData.title
  message.textContent = ""
  levelChange.textContent = rewardData.levelChange ?? ""
  levelChange.hidden = rewardData.levelChange === null
  experienceSection.hidden = rewardData.showExperience === false
  experienceSources.replaceChildren()

  const sources = Array.isArray(rewardData.experienceSources)
    ? rewardData.experienceSources
    : []

  sources.forEach((source) => {
    const sourceRow = experienceTemplate.content.firstElementChild?.cloneNode(true)

    if (!(sourceRow instanceof Element)) {
      return
    }

    const sourceLabel = sourceRow.querySelector(
      "[data-card-reward-experience-label]"
    )
    const sourceValue = sourceRow.querySelector(
      "[data-card-reward-experience-value]"
    )

    if (sourceLabel === null || sourceValue === null) {
      return
    }

    sourceLabel.textContent = source.label
    sourceValue.textContent = `+${source.value}`
    experienceSources.append(sourceRow)
  })

  totalExperience.textContent = `+${rewardData.totalExperience}exp`
  modalLayer.hidden = false
  document.body.classList.add("modal-open")
  void playCardRewardAnimation(
    modalLayer,
    card,
    flipper,
    message,
    dialogue,
    taskEffectsConfig,
    cardRewardAnimationRunId
  )

  return true
}

// 新規登録直後の一時データも、通常報酬と同じモーダル表示処理へ渡す
function openInitialCardRewardModal(taskEffectsConfig, onClosed) {
  const modalLayer = document.querySelector("[data-card-reward-modal]")
  const initialRewardJson = modalLayer?.dataset.initialCardReward

  if (typeof initialRewardJson !== "string" || initialRewardJson === "") {
    return false
  }

  delete modalLayer.dataset.initialCardReward

  try {
    const initialReward = JSON.parse(initialRewardJson)

    if (initialReward === null || typeof initialReward !== "object") {
      throw new Error("初期カード報酬の形式が不正です")
    }

    return openCardRewardModal(
      initialReward,
      taskEffectsConfig,
      onClosed
    )
  } catch (error) {
    console.error("初期カード報酬を表示できませんでした", error)
    return false
  }
}

// シュカモン獲得ポップアップを閉じる関数
function closeCardRewardModal() {
  const modalLayer = document.querySelector("[data-card-reward-modal]")

  if (
    modalLayer === null ||
    modalLayer.hasAttribute("data-card-reward-close-locked")
  ) {
    return false
  }

  const message = modalLayer.querySelector("[data-card-reward-message]")

  if (message !== null) {
    dialogueTypingControllers.get(message)?.abort()
  }

  cardRewardAnimationRunId += 1
  modalLayer.hidden = true
  document.body.classList.remove("modal-open")
  const onClosed = cardRewardModalOnClosed

  cardRewardModalOnClosed = null

  Promise.resolve(onClosed?.()).catch((error) => {
    console.error("獲得ポップアップ閉鎖後のセリフを表示できませんでした", error)
  })

  return true
}

// OK、オーバーレイ、Escapeキーで閉じる操作を登録する関数
function setupCardRewardModal() {
  const modalLayer = document.querySelector("[data-card-reward-modal]")

  if (modalLayer === null) {
    return
  }

  modalLayer.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return
    }

    if (
      event.target === modalLayer ||
      event.target.closest("[data-card-reward-close]") !== null
    ) {
      closeCardRewardModal()
    }
  })

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modalLayer.hidden) {
      closeCardRewardModal()
    }
  })
}

function closeTaskSettingsModal() {
  const modalLayer = document.querySelector("[data-task-settings-modal]")
  const openButton = document.querySelector("[data-task-settings-open]")

  if (modalLayer === null) {
    return
  }

  modalLayer.hidden = true
  document.body.classList.remove("modal-open")
  openButton?.focus({ preventScroll: true })
}

function openTaskSettingsModal(offsetDate) {
  const modalLayer = document.querySelector("[data-task-settings-modal]")

  if (modalLayer === null) {
    return
  }

  const taskStates = loadTaskStates(offsetDate)
  const modal = modalLayer.querySelector(".task-settings-modal")

  TASK_POSITIONS.forEach((taskId) => {
    const inputSet = modalLayer.querySelector(
      `[data-task-settings-position="${taskId}"]`
    )
    const jobInput = inputSet?.querySelector("[data-task-settings-job]")
    const descriptionInput = inputSet?.querySelector(
      "[data-task-settings-description]"
    )
    const content = taskContent(taskStates[taskId], taskId)

    if (
      jobInput instanceof HTMLInputElement &&
      descriptionInput instanceof HTMLTextAreaElement
    ) {
      jobInput.value = content.job
      descriptionInput.value = content.description
    }
  })

  modalLayer.hidden = false
  document.body.classList.add("modal-open")
  modal?.scrollTo({ top: 0 })
  modalLayer.querySelector("[data-task-settings-close]")?.focus({
    preventScroll: true
  })
}

function saveTaskSettings(offsetDate, todayCompleted) {
  const modalLayer = document.querySelector("[data-task-settings-modal]")

  if (modalLayer === null) {
    return null
  }

  const taskStates = loadTaskStates(offsetDate)
  const wasAllCompleted = areAllTasksCompleted(taskStates)

  TASK_POSITIONS.forEach((taskId) => {
    const inputSet = modalLayer.querySelector(
      `[data-task-settings-position="${taskId}"]`
    )
    const jobInput = inputSet?.querySelector("[data-task-settings-job]")
    const descriptionInput = inputSet?.querySelector(
      "[data-task-settings-description]"
    )

    if (
      !(jobInput instanceof HTMLInputElement) ||
      !(descriptionInput instanceof HTMLTextAreaElement)
    ) {
      return
    }

    const currentTask = taskStates[taskId]
    const wasActive = taskHasJob(currentTask, taskId)
    let job = jobInput.value.trim()
    const description = descriptionInput.value.trim()

    if (job === "" && description !== "") {
      job = "タスク"
    }

    const active = job !== ""
    const completed = active && wasActive
      ? taskIsCompleted(currentTask)
      : active && todayCompleted

    taskStates[taskId] = {
      completed: completed,
      job: job,
      description: description
    }
  })

  saveTaskStates(offsetDate, taskStates)
  restoreTaskStates(taskStates)

  return {
    taskStates: taskStates,
    becameAllCompleted: (
      !wasAllCompleted && areAllTasksCompleted(taskStates)
    )
  }
}

function setupTaskSettingsModal(offsetDate, completionState) {
  const modalLayer = document.querySelector("[data-task-settings-modal]")
  const openButton = document.querySelector("[data-task-settings-open]")
  const form = modalLayer?.querySelector("[data-task-settings-form]")

  if (modalLayer === null || openButton === null || form === null) {
    return
  }

  openButton.addEventListener("click", () => {
    openTaskSettingsModal(offsetDate)
  })

  modalLayer.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return
    }

    if (event.target.closest("[data-task-settings-close]") !== null) {
      closeTaskSettingsModal()
      return
    }

    const deleteButton = event.target.closest("[data-task-settings-delete]")

    if (deleteButton === null) {
      return
    }

    if (!window.confirm("削除しますか？")) {
      return
    }

    const inputSet = deleteButton.closest("[data-task-settings-position]")
    const jobInput = inputSet?.querySelector("[data-task-settings-job]")
    const descriptionInput = inputSet?.querySelector(
      "[data-task-settings-description]"
    )

    if (
      jobInput instanceof HTMLInputElement &&
      descriptionInput instanceof HTMLTextAreaElement
    ) {
      jobInput.value = ""
      descriptionInput.value = ""
      jobInput.focus()
    }
  })

  form.addEventListener("submit", async (event) => {
    event.preventDefault()

    const result = saveTaskSettings(
      offsetDate,
      completionState.todayCompleted
    )

    if (result === null) {
      return
    }

    closeTaskSettingsModal()

    if (completionState.todayCompleted) {
      lockCompletedTaskList()
    } else if (!areAllTasksCompleted(result.taskStates)) {
      unlockCompletedTaskList()
    }

    if (result.becameAllCompleted && !completionState.todayCompleted) {
      await handleAllTasksCompleted(
        offsetDate,
        result.taskStates,
        completionState
      )
    }
  })
}

// タスク完了を送信する関数
async function submitTaskCompletion(offsetDate) {
  const csrfToken = document.querySelector(
    'meta[name="csrf-token"]'
  )?.content

  if (!csrfToken) {
    throw new Error("CSRFトークンを取得できませんでした")
  }

  const requestUrl = new URL("/tasks", window.location.origin)
  // URLクエリを読み直さず、Railsが画面へ渡したoffset_dateを送信に再利用する。
  requestUrl.searchParams.set("debug_date", offsetDate)

  const response = await fetch(requestUrl, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "X-CSRF-Token": csrfToken
    }
  })

  const result = await response.json()

  if (!response.ok) {
    const error = new Error(
      result.message || "達成記録の保存に失敗しました"
    )

    error.code = result.error_code

    throw error
  }

  return result
}

async function handleAllTasksCompleted(
  offsetDate,
  taskStates,
  completionState,
  revertCompletion = null
) {
  const confirmed = window.confirm(
    "すべてのタスクを達成して、ガチャを回しますか？"
  )

  if (!confirmed) {
    revertCompletion?.()
    return
  }

  try {
    const result = await submitTaskCompletion(offsetDate)

    completionState.todayCompleted = true
    updateCalendarAfterTaskCompletion()
    lockCompletedTaskList()

    const rewardData = buildCardRewardData(result)
    const showCompletedDialogue = () => showSyukamonDialogue(
      "done",
      completionState.taskEffectsConfig
    )

    if (rewardData !== null) {
      try {
        const modalOpened = openCardRewardModal(
          rewardData,
          completionState.taskEffectsConfig,
          showCompletedDialogue
        )

        if (!modalOpened) {
          void showCompletedDialogue()
        }
      } catch (displayError) {
        // 保存成功後の表示エラーでは、達成済み状態を差し戻さない。
        console.error("カード報酬を表示できませんでした", displayError)
        void showCompletedDialogue()
      }
    } else {
      void showCompletedDialogue()
    }
  } catch (error) {
    if (error.code === "already_completed") {
      completionState.todayCompleted = true
      window.alert(
        "すでに別の端末で達成しています"
      )

      lockCompletedTaskList()
    } else {
      revertCompletion?.()

      window.alert(
        "通信に失敗しました。もう一度お試しください"
      )

      console.error(error)
    }
  }
}

// 以下、タスククリック時の処理
// タスクにチェックをつける
async function handleTaskClick(event, offsetDate, completionState) {
  if (!(event.target instanceof Element)) {
    return
  }

  const taskElement = event.target.closest(".task-item[data-task-id]")

  if (taskElement === null || taskElement.closest(".task-list") === null) {
    return
  }

  const taskListContainer = taskElement.closest(".task-list-container")

  // CSSのオーバーレイに加え、JavaScript側でもロック後の処理を防ぐ。
  if (taskListContainer?.classList.contains("task-list-container--locked")) {
    return
  }

  const taskId = taskElement.dataset.taskId
  const taskStates = loadTaskStates(offsetDate)

  // クリック後に達成状態ならtrue
  const nextState = !taskIsCompleted(taskStates[taskId])

  taskStates[taskId] = updateTaskCompletion(taskStates[taskId], nextState)

  // localStorageにtaskStatesごと保存
  saveTaskStates(offsetDate, taskStates)

  // _task.html.erbの最外殻にクラスを追加・削除
  // toggleは、第2引数がtrueなら追加、falseなら削除
  taskElement.classList.toggle(
    "task-item--completed",
    nextState
  )

  const checkElement = taskElement.querySelector(".task-item__check")

  if (checkElement !== null) {
    checkElement.toggleAttribute("hidden", !nextState)
  }

  //レスポンス
  if (areAllTasksCompleted(taskStates)) {
    await handleAllTasksCompleted(
      offsetDate,
      taskStates,
      completionState,
      () => {
        revertTaskToIncomplete(
          taskElement,
          taskStates,
          taskId,
          offsetDate
        )
      }
    )
  }

}

// タスククリック時の処理ここまで

const appContent = document.querySelector(
  ".app-content[data-offset-date]"
)
const offsetDate = appContent?.dataset.offsetDate

if (!offsetDate) {
  console.error(
    "data-offset-dateを取得できないため、タスク処理を開始できません"
  )
} else if (appContent.dataset.tasksInitialized === "true") {
  console.warn("タスク処理は初期化済みです")
} else {
  let taskEffectsConfig = null

  try {
    taskEffectsConfig = loadTaskEffectsConfig()
  } catch (error) {
    console.error("タスク演出設定を読み込めませんでした", error)
  }

  if (taskEffectsConfig !== null) {
    appContent.dataset.tasksInitialized = "true"
    tasksPagePreparationController = new AbortController()
    window.addEventListener("pagehide", stopTasksPageEffects, { once: true })
    saveSubmittedNickname(appContent)
    const syukamonState = initializeSyukamonDialogue()
    const initialDialoguePreparation = prepareTasksPage(
      syukamonState.dialogueType,
      tasksPagePreparationController.signal
    )
    const startInitialDialogueTyping = async () => {
      const preparedDialogue = await initialDialoguePreparation

      if (
        preparedDialogue === null ||
        tasksPagePreparationController.signal.aborted
      ) {
        return false
      }

      return typeDialogue(
        preparedDialogue.message,
        preparedDialogue.dialogue,
        taskEffectsConfig.characterIntervalMs
      )
    }
    const completionState = {
      todayCompleted: syukamonState.todayCompleted,
      taskEffectsConfig: taskEffectsConfig
    }
    const initialTaskStates = loadTaskStates(offsetDate)
    const taskSetupApplied = applyTaskSetup(
      initialTaskStates,
      appContent.dataset.taskSetupJob,
      appContent.dataset.taskSetupDescription
    )

    if (taskSetupApplied) {
      saveTaskStates(offsetDate, initialTaskStates)
    }

    setupCardRewardModal()
    setupTaskSettingsModal(offsetDate, completionState)
    const initialModalOpened = openInitialCardRewardModal(
      taskEffectsConfig,
      startInitialDialogueTyping
    )

    if (!initialModalOpened) {
      void startInitialDialogueTyping()
    }

    // jsでは関数を発動したければ、引数がなくても()をつける。  即発動しない（例えばaddEventListenerに渡す場合)なら、()はつけない。
    restoreTaskStates(initialTaskStates)

    if (syukamonState.todayCompleted || areAllTasksCompleted(initialTaskStates)) {
      lockCompletedTaskList()
    }

    document.addEventListener("click", (event) => {
      handleTaskClick(event, offsetDate, completionState)
    })
  }
}
