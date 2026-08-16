import test from "node:test"
import assert from "node:assert/strict"

import {
  BattlePreparationFailure,
  buildBattleResultViewModel,
  prepareBattleViewWithRetry,
  selectResultUserCard,
  setupBattleResultActions,
  startPreparedBattle,
} from "../../../app/javascript/battle_flow.js"
import {
  BATTLE_PREPARATION_FAILURE_CLASSIFICATIONS,
  BattleViewPreparationError
} from "../../../app/javascript/battle_dom.js"

class FakeClassList {
  constructor() { this.values = new Set() }
  add(...values) { values.forEach((value) => this.values.add(value)) }
  remove(...values) { values.forEach((value) => this.values.delete(value)) }
  contains(value) { return this.values.has(value) }
}

class FakeElement {
  constructor() {
    this.dataset = {}
    this.style = {}
    this.hidden = false
    this.inert = false
    this.disabled = false
    this.textContent = ""
    this.attributes = new Map()
    this.listeners = new Map()
    this.classList = new FakeClassList()
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? []
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener))
  }

  async click() {
    const event = { preventDefault() {} }
    await Promise.all((this.listeners.get("click") ?? []).map((listener) => listener(event)))
  }
}

function createContext() {
  return {
    userCards: {
      A: { id: 1, isRental: true },
      B: { id: 2, isRental: false },
      C: { id: 3, isRental: false },
      D: { id: 4, isRental: true },
      E: { id: 5, isRental: true },
    },
    enemyCards: {},
    syukamonData: {
      "2": { id: 2, name: "正式なニカ", short_name: "ニカ", win: "【nick】、やったね！", lose: "次こそだよ、【nick】" },
      "3": { id: 3, name: "正式なサンカ", short_name: "サンカ", win: "勝ったよ", lose: "負けたよ" },
    },
    config: {
      battle: {
        internal_rate: {
          difficulty: {
            normal: { win_gain: 150, lose_decrease: 100 },
          },
        },
        result: { card_width_ratio: 1.2 },
      },
      animations: {},
    },
    assets: {
      cardImageUrls: { "2": "/cards/2.png", "3": "/cards/3.png" },
    },
    battleSession: {
      token: "session-token",
      difficulty: "normal",
      displayRateBeforeBattle: 15,
      displayRateWinBonus: 17,
    },
  }
}

function createPageUi() {
  const resultScreen = new FakeElement()
  resultScreen.dataset.tasksUrl = "/cards"
  resultScreen.dataset.rematchUrl = "/battle"

  return {
    resultScreenElement: resultScreen,
    resultActionElements: [new FakeElement(), new FakeElement()],
    resultErrorElement: new FakeElement(),
  }
}

test("selectResultUserCard は非レンタルカードだけから1回抽選する", () => {
  const context = createContext()
  let randomCalls = 0
  const selected = selectResultUserCard(context.userCards, () => {
    randomCalls += 1
    return 0.99
  })

  assert.equal(selected.slot, "C")
  assert.equal(selected.card.id, 3)
  assert.equal(selected.card.isRental, false)
  assert.equal(randomCalls, 1)
})

test("selectResultUserCard は通常カードが0枚なら安全にnullを返す", () => {
  const context = createContext()
  Object.values(context.userCards).forEach((card) => { card.isRental = true })

  assert.equal(selectResultUserCard(context.userCards, () => {
    throw new Error("抽選してはいけない")
  }), null)
})

test("勝利リザルトは保存済み難易度のwin_gainとbonusで表示レートをプレビューする", () => {
  const context = createContext()
  const storage = { getItem: (key) => key === "keizokuou_nickname" ? "にんじん" : null }
  const viewModel = buildBattleResultViewModel({
    context,
    result: { status: "completed", winner: "user" },
    randomFn: () => 0,
    storage,
  })

  assert.equal(viewModel.outcome, "win")
  assert.equal(viewModel.rateBefore, 15)
  assert.equal(viewModel.rateAfter, 182)
  assert.equal(viewModel.cardView.cardId, 2)
  assert.equal(viewModel.cardView.name, "ニカ")
  assert.equal(viewModel.cardView.message, "にんじん、やったね！")
  assert.equal(viewModel.cardView.cardImageUrl, "/cards/2.png")
})

test("敗北リザルトは表示レートを変えずloseセリフを使う", () => {
  const viewModel = buildBattleResultViewModel({
    context: createContext(),
    result: { status: "completed", winner: "enemy" },
    randomFn: () => 0,
    storage: { getItem: () => null },
  })

  assert.equal(viewModel.outcome, "lose")
  assert.equal(viewModel.rateBefore, 15)
  assert.equal(viewModel.rateAfter, 15)
  assert.equal(viewModel.cardView.message, "次こそだよ、ユーザー")
})

test("事前準備完了後に戦闘を1回だけ開始し、二重開始しない", async () => {
  const context = createContext()
  const battleUi = { battleElement: new FakeElement() }
  const lifecycle = { promise: null }
  let releasePreparation
  const preparationPromise = new Promise((resolve) => { releasePreparation = resolve })
  let battleCalls = 0
  let releaseBattle
  const battleBarrier = new Promise((resolve) => { releaseBattle = resolve })
  const options = {
    context,
    battleUi,
    lifecycle,
    preparationPromise,
    runBattleFn: async () => {
      battleCalls += 1
      await battleBarrier
      return { status: "cancelled", winner: null }
    },
  }

  const first = startPreparedBattle(options)
  const second = startPreparedBattle(options)

  assert.equal(first, second)
  assert.equal(battleCalls, 0)
  releasePreparation()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(battleCalls, 1)
  releaseBattle()
  const result = await first

  assert.equal(result.status, "cancelled")
  assert.equal(battleCalls, 1)
  assert.equal(battleUi.battleElement.inert, false)
  assert.equal(battleUi.battleElement.getAttribute("aria-hidden"), "false")
})

test("事前準備失敗時は通常戦闘を開始しない", async () => {
  const context = createContext()
  const battleUi = { battleElement: new FakeElement() }
  const lifecycle = { promise: null }
  let battleCalls = 0

  await assert.rejects(
    startPreparedBattle({
      context,
      battleUi,
      lifecycle,
      preparationPromise: Promise.reject(new Error("layout is not ready")),
      runBattleFn: async () => {
        battleCalls += 1
        return { status: "cancelled", winner: null }
      }
    }),
    /layout is not ready/
  )

  assert.equal(battleCalls, 0)
})

test("表示サイズ未確定は失敗済みPromiseを使い回さずprepare処理を1回だけ再実行する", async () => {
  let prepareCalls = 0
  let retryLogs = 0
  const result = await prepareBattleViewWithRetry({
    battleUi: {},
    documentRef: {},
    logger: { warn() { retryLogs += 1 } },
    prepareBattleViewFn: async () => {
      prepareCalls += 1
      if (prepareCalls === 1) {
        throw new BattleViewPreparationError("サイズ未確定", {
          code: "display-bounds-not-ready",
          classification: BATTLE_PREPARATION_FAILURE_CLASSIFICATIONS.RETRYABLE,
          elementLabel: "カード1"
        })
      }
      return { ready: true }
    }
  })

  assert.deepEqual(result, { ready: true })
  assert.equal(prepareCalls, 2)
  assert.equal(retryLogs, 1)
})

test("表示サイズ未確定が2回続く場合は戦闘準備を停止する", async () => {
  let prepareCalls = 0
  let failure
  await assert.rejects(
    prepareBattleViewWithRetry({
      battleUi: {},
      documentRef: {},
      logger: { warn() {} },
      prepareBattleViewFn: async () => {
        prepareCalls += 1
        throw new BattleViewPreparationError("サイズ未確定", {
          code: "display-bounds-not-ready",
          classification: BATTLE_PREPARATION_FAILURE_CLASSIFICATIONS.RETRYABLE,
          elementLabel: "戦闘エリア"
        })
      }
    }),
    (error) => {
      failure = error
      return error instanceof BattlePreparationFailure
    }
  )

  assert.equal(prepareCalls, 2)
  assert.equal(failure.classification, BATTLE_PREPARATION_FAILURE_CLASSIFICATIONS.RETRYABLE)
  assert.equal(failure.attempts, 2)
  assert.equal(failure.cause.elementLabel, "戦闘エリア")
})

test("必須DOM欠損等の契約違反はprepare処理を再試行しない", async () => {
  let prepareCalls = 0
  let failure
  await assert.rejects(
    prepareBattleViewWithRetry({
      battleUi: {},
      documentRef: {},
      logger: { warn() { throw new Error("再試行してはいけません") } },
      prepareBattleViewFn: async () => {
        prepareCalls += 1
        throw new Error("必須カードDOMがありません")
      }
    }),
    (error) => {
      failure = error
      return error instanceof BattlePreparationFailure
    }
  )

  assert.equal(prepareCalls, 1)
  assert.equal(failure.classification, BATTLE_PREPARATION_FAILURE_CLASSIFICATIONS.FATAL)
  assert.equal(failure.attempts, 1)
  assert.match(failure.cause.message, /必須カードDOM/)
})

test("降参は通常戦闘を中断し、架空の攻撃結果なしで敵勝利の完了結果にする", async () => {
  const context = createContext()
  context.root = new FakeElement()
  const battleUi = { battleElement: new FakeElement() }
  const lifecycle = { promise: null }
  let confirmSurrender
  let shownResult = null
  let finishCalls = 0
  let destroyCalls = 0

  const result = await startPreparedBattle({
    context,
    battleUi,
    lifecycle,
    setupSurrenderFn: ({ onConfirm }) => {
      confirmSurrender = onConfirm
      return {
        setVisible() {},
        setEnabled(available) {
          if (available) confirmSurrender()
        },
        finish() { finishCalls += 1 },
        destroy() { destroyCalls += 1 }
      }
    },
    runBattleFn: async (_context, { signal, onSurrenderAvailabilityChange }) => {
      onSurrenderAvailabilityChange(true)
      assert.equal(signal.aborted, true)
      return { status: "cancelled", winner: null }
    },
    showResultFn: ({ result: surrenderedResult }) => { shownResult = surrenderedResult }
  })

  assert.equal(result.status, "completed")
  assert.equal(result.winner, "enemy")
  assert.equal(result.reason, "surrender")
  assert.equal(result.lastAttacker, null)
  assert.equal(result.lastDefeated, null)
  assert.equal(result.finalAttackResult, null)
  assert.equal(shownResult, result)
  assert.equal(finishCalls, 1)
  assert.equal(destroyCalls, 1)
})

test("降参結果の保存は確定時ではなくリザルト操作時にtokenとloseだけを送る", async () => {
  const context = createContext()
  const pageUi = createPageUi()
  const calls = []
  pageUi.resultActionElements[0].dataset.battleResultAction = "finish"
  pageUi.resultActionElements[1].dataset.battleResultAction = "rematch"

  setupBattleResultActions({
    context,
    result: { status: "completed", winner: "enemy", reason: "surrender" },
    pageUi,
    saveResultFn: async (payload) => {
      calls.push(payload)
      return { finalInternalRate: 100, finalDisplayRate: 15 }
    },
    locationRef: { assign() {} }
  })

  assert.deepEqual(calls, [])
  await pageUi.resultActionElements[0].click()
  assert.deepEqual(calls, [{ battleSessionToken: "session-token", result: "lose" }])
})

test("セーブして終わるはtokenとwinだけを送り、保存済み最終値の後でcardsへ遷移する", async () => {
  const context = createContext()
  const pageUi = createPageUi()
  const calls = []
  const navigations = []
  pageUi.resultActionElements[0].dataset.battleResultAction = "finish"
  pageUi.resultActionElements[1].dataset.battleResultAction = "rematch"

  setupBattleResultActions({
    context,
    result: { status: "completed", winner: "user" },
    pageUi,
    saveResultFn: async (payload) => {
      calls.push(payload)
      return { finalInternalRate: 2150, finalDisplayRate: 182 }
    },
    locationRef: { assign: (url) => navigations.push(url) },
  })

  await Promise.all([pageUi.resultActionElements[0].click(), pageUi.resultActionElements[0].click()])

  assert.deepEqual(calls, [{ battleSessionToken: "session-token", result: "win" }])
  assert.deepEqual(navigations, ["/cards"])
  assert.equal(pageUi.resultActionElements[0].disabled, true)
  assert.equal(pageUi.resultActionElements[1].disabled, true)
})

test("保存失敗時はリザルトに留まり、技術用語なしの表示で両ボタンを再有効化する", async () => {
  const context = createContext()
  const pageUi = createPageUi()
  const navigations = []
  pageUi.resultActionElements[0].dataset.battleResultAction = "finish"
  pageUi.resultActionElements[1].dataset.battleResultAction = "rematch"

  setupBattleResultActions({
    context,
    result: { status: "completed", winner: "enemy" },
    pageUi,
    saveResultFn: async () => { throw new Error("HTTP 500") },
    locationRef: { assign: (url) => navigations.push(url) },
  })

  await pageUi.resultActionElements[1].click()

  assert.deepEqual(navigations, [])
  assert.equal(pageUi.resultErrorElement.hidden, false)
  assert.equal(pageUi.resultActionElements[0].disabled, false)
  assert.equal(pageUi.resultActionElements[1].disabled, false)
})

test("セーブしてもう一度は保存成功後に新しいbattleページへ遷移する", async () => {
  const context = createContext()
  const pageUi = createPageUi()
  const navigations = []
  pageUi.resultActionElements[0].dataset.battleResultAction = "finish"
  pageUi.resultActionElements[1].dataset.battleResultAction = "rematch"

  setupBattleResultActions({
    context,
    result: { status: "completed", winner: "enemy" },
    pageUi,
    saveResultFn: async ({ battleSessionToken, result }) => {
      assert.equal(battleSessionToken, "session-token")
      assert.equal(result, "lose")
      return { finalInternalRate: 1900, finalDisplayRate: 15 }
    },
    locationRef: { assign: (url) => navigations.push(url) },
  })

  await pageUi.resultActionElements[1].click()

  assert.deepEqual(navigations, ["/battle"])
})
