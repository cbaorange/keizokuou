import test from "node:test"
import assert from "node:assert/strict"

import {
  executeCombatPair,
  executeSingleAttack,
  runNormalBattle,
  runNormalTurn,
  selectAttackCutIn
} from "../../../app/javascript/battle_flow.js"

class FakeElement {
  constructor({ dataset = {}, label = "" } = {}) {
    this.dataset = { ...dataset }
    this.label = label
    this.style = {}
    this.attributes = { "aria-disabled": "false" }
    this.shadow = {}
  }

  querySelector(selector) {
    return selector === "[data-battle-animation-shadow]" ? this.shadow : null
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
  }

  getAttribute(name) {
    return this.attributes[name] ?? null
  }
}

function createCard(id, overrides = {}) {
  return {
    id,
    type: "mon",
    initialHp: 100,
    currentHp: 100,
    initialAtk: 40,
    currentAtk: 40,
    initialSpd: 50,
    currentSpd: 50,
    buffType: "none",
    buffAmount: 0,
    canBattle: true,
    revengeBuffPending: false,
    isRental: false,
    ...overrides
  }
}

function createFixture({ userOverrides = {}, enemyOverrides = {} } = {}) {
  const userCards = {}
  const enemyCards = {}
  const elements = new Map()
  const statuses = new Map()

  for (const [index, slot] of ["A", "B", "C", "D", "E"].entries()) {
    const card = createCard(index + 1, {
      canBattle: index === 0,
      ...(slot === "A" ? userOverrides : {})
    })
    userCards[slot] = card
    elements.set(`user/${slot}`, new FakeElement({
      dataset: {
        team: "user",
        slot,
        cardId: String(card.id),
        canBattle: String(card.canBattle),
        selected: "false",
        deployed: "false"
      }
    }))
  }
  for (const [index, slot] of ["V", "W", "X", "Y", "Z"].entries()) {
    const card = createCard(index + 11, {
      type: "wed",
      canBattle: index === 0,
      ...(slot === "V" ? enemyOverrides : {})
    })
    enemyCards[slot] = card
    elements.set(`enemy/${slot}`, new FakeElement({
      dataset: {
        team: "enemy",
        slot,
        cardId: String(card.id),
        canBattle: String(card.canBattle),
        selected: "false",
        deployed: "false"
      }
    }))
  }

  for (const [key] of elements) {
    statuses.set(key, {
      statusElement: new FakeElement({ label: `${key}:status` }),
      hpBarElement: new FakeElement({ label: `${key}:hp-bar` }),
      hpFillElement: new FakeElement({ label: `${key}:hp-fill` }),
      currentHpElement: new FakeElement({ label: `${key}:hp` }),
      maxHpElement: new FakeElement({ label: `${key}:max-hp` })
    })
  }

  const ui = {
    battleElement: new FakeElement(),
    userCardElements: [...elements.entries()].filter(([key]) => key.startsWith("user/")).map(([, value]) => value),
    enemyCardElements: [...elements.entries()].filter(([key]) => key.startsWith("enemy/")).map(([, value]) => value),
    userStatusListElement: new FakeElement(),
    enemyStatusListElement: new FakeElement(),
    userBattleAreaElement: new FakeElement(),
    enemyBattleAreaElement: new FakeElement(),
    userBattleStatusAnchorElement: new FakeElement(),
    enemyBattleStatusAnchorElement: new FakeElement(),
    userDefeatEffectLayerElement: new FakeElement({ label: "user:defeat-layer" }),
    enemyDefeatEffectLayerElement: new FakeElement({ label: "enemy:defeat-layer" }),
    choiceDimElement: new FakeElement(),
    choicePromptElement: new FakeElement(),
    battleStartElement: new FakeElement(),
    entryCoverElement: new FakeElement()
  }
  const context = {
    root: {},
    userCards,
    enemyCards,
    difficulty: "normal",
    config: {
      battle: { attack: { spd_loss: 10 } },
      animations: {
        card_entry: { duration_ms: 500 },
        attack_wait: {
          first: { duration_ms: 1200 },
          second: { duration_ms: 800 }
        },
        number_change: { duration_ms: 300, full_duration_change: 20, min_duration_ms: 0 }
      },
      effects: {
        cut_in: {
          text: {
            user_advantage: "弱点をついた！！",
            enemy_advantage: "弱点をつかれた！！"
          }
        }
      }
    },
    assets: {
      cardBackUrl: "/card-back.PNG",
      portraitImageUrls: {}
    }
  }

  context.assets.portraitImageUrls = Object.fromEntries(
    [...Object.values(userCards), ...Object.values(enemyCards)]
      .map((card) => [String(card.id), `/portrait-${card.id}.PNG`])
  )
  context.syukamonData = Object.fromEntries(
    [...Object.values(userCards), ...Object.values(enemyCards)]
      .map((card) => [`card_${card.id}`, {
        id: card.id,
        normal_defeat: `通常撃破 ${card.id}`,
        final_defeat: `最終撃破 ${card.id}`
      }])
  )

  return { context, elements, statuses, ui }
}

function createServices(fixture, overrides = {}) {
  const calls = {
    waits: [],
    numberChanges: [],
    choiceDimmedEnemyCards: [],
    covers: 0,
    retreats: 0,
    movesToBattle: 0,
    reveals: 0,
    showsBattleStatus: 0,
    movesToHand: 0,
    restores: 0,
    revenge: 0,
    entries: 0,
    coverFades: [],
    coverFinishes: 0,
    battleStarts: 0,
    syncs: 0,
    choiceStates: [],
    cutIns: [],
    mobileHudVisibility: [],
    sequence: []
  }
  const { context, elements, statuses, ui } = fixture
  const services = {
    getCardElement: (_root, team, slot) => elements.get(`${team}/${slot}`),
    getStatusElements: (_root, team, slot) => statuses.get(`${team}/${slot}`),
    getBattleUiElements: () => ui,
    setCardBattleState: ({ team, slot, canBattle }) => {
      const element = elements.get(`${team}/${slot}`)
      element.dataset.canBattle = String(canBattle)
      element.setAttribute("aria-disabled", String(!canBattle))
    },
    setCardSelectionState: (element, { selected, deployed = null }) => {
      element.dataset.selected = String(selected)
      if (deployed !== null) element.dataset.deployed = String(deployed)
    },
    setCardInteractionEnabled: (element, enabled) => {
      element.setAttribute("aria-disabled", String(!enabled))
    },
    syncDefeatEffectLayer: () => { calls.syncs += 1 },
    hideCardChoice: ({ dimElement, promptElement }) => {
      dimElement.style.visibility = "hidden"
      promptElement.style.visibility = "hidden"
      calls.choiceStates.push("hidden")
    },
    waitForUserCardSelection: async () => ({
      slot: "A",
      card: context.userCards.A,
      cardElement: elements.get("user/A")
    }),
    selectRandomCpuCard: () => context.enemyCards.V,
    determineFirstAttacker: () => "user",
    hasBattleableCard: (cards) => cards.some((card) => card.canBattle === true),
    canAttack: (attacker, defender) => attacker.canBattle === true && defender.canBattle === true,
    resolveAttack: (attacker, defender) => {
      const defenderHpBefore = defender.currentHp
      const attackerSpdBefore = attacker.currentSpd
      const damage = attacker.currentAtk
      defender.currentHp = Math.max(0, defender.currentHp - damage)
      attacker.currentSpd = Math.max(0, attacker.currentSpd - 10)
      const defeated = defender.currentHp === 0
      if (defeated) {
        defender.canBattle = false
        defender.revengeBuffPending = true
      }
      return {
        attackSucceeded: true,
        damage,
        defeated,
        defenderHpBefore,
        defenderHpAfter: defender.currentHp,
        attackerSpdBefore,
        attackerSpdAfter: attacker.currentSpd
      }
    },
    wait: async (duration) => {
      calls.waits.push(duration)
      calls.sequence.push(`wait:${duration}`)
    },
    playAttackMotion: async ({ onImpact }) => {
      calls.sequence.push("attack")
      await onImpact()
    },
    playBattleCutIn: async (options) => {
      calls.cutIns.push(options)
      calls.sequence.push(`cut-in:${options.team}`)
    },
    playHitEffect: async () => {},
    playHitShake: async () => {},
    showDamageNumber: async () => {},
    animateNumberChange: async ({ numberElement, fromValue, toValue }) => {
      calls.numberChanges.push({ label: numberElement.label, fromValue, toValue })
    },
    animateHpBar: async () => {},
    animateMobileCardHudHp: async () => {},
    playDefeatEffect: async () => {},
    fadeDefeatedCard: async () => {},
    showCardChoice: async ({ dimElement, promptElement }) => {
      dimElement.style.visibility = "visible"
      promptElement.style.visibility = "visible"
      calls.choiceStates.push("visible")
    },
    dimCardsForChoice: async ({ cardElements }) => {
      calls.choiceDimmedEnemyCards.push(cardElements.map((element) => element.dataset.slot))
    },
    coverCard: async () => { calls.covers += 1 },
    retreatHandCards: async () => { calls.retreats += 1 },
    moveCardToBattle: async () => { calls.movesToBattle += 1 },
    revealCard: async ({ team }) => {
      calls.reveals += 1
      calls.sequence.push(`reveal:${team}`)
    },
    showBattleStatus: async ({ battleStatusElement }) => {
      calls.showsBattleStatus += 1
      calls.sequence.push(`show-status:${battleStatusElement.label}`)
    },
    moveCardToHand: async () => { calls.movesToHand += 1 },
    restoreHandCards: async () => { calls.restores += 1 },
    setMobileCardHudVisible: ({ team, slot, visible }) => {
      calls.mobileHudVisibility.push({ team, slot, visible })
      calls.sequence.push(`mobile-hud:${team}:${slot}:${visible}`)
    },
    applyPendingRevengeBuffs: () => 0,
    playRevengeBuff: async () => { calls.revenge += 1 },
    playCardEntry: async () => { calls.entries += 1 },
    beginBattleEntryCoverFade: ({ durationMs }) => { calls.coverFades.push(durationMs) },
    finishBattleEntryCover: () => { calls.coverFinishes += 1 },
    playBattleStart: async () => { calls.battleStarts += 1 },
    ...overrides
  }
  return { services, calls }
}

test("カットイン判定は最終撃破、通常撃破、属性有利の優先順で状態を変更しない", () => {
  const finalFixture = createFixture({
    userOverrides: { type: "mon", currentAtk: 100 },
    enemyOverrides: { type: "sun", currentHp: 30 }
  })
  const finalCutIn = selectAttackCutIn({
    attackerEntry: { team: "user", slot: "A", card: finalFixture.context.userCards.A },
    defenderEntry: { team: "enemy", slot: "V", card: finalFixture.context.enemyCards.V },
    context: finalFixture.context
  })
  assert.equal(finalCutIn.kind, "final-defeat")
  assert.equal(finalCutIn.text, "最終撃破 1")
  assert.equal(finalCutIn.portraitUrl, "/portrait-1.PNG")
  assert.equal(finalFixture.context.enemyCards.V.currentHp, 30)
  assert.equal(finalFixture.context.userCards.A.currentSpd, 50)

  const normalFixture = createFixture({ userOverrides: { currentAtk: 100 }, enemyOverrides: { currentHp: 30 } })
  normalFixture.context.enemyCards.W.canBattle = true
  const normalCutIn = selectAttackCutIn({
    attackerEntry: { team: "user", slot: "A", card: normalFixture.context.userCards.A },
    defenderEntry: { team: "enemy", slot: "V", card: normalFixture.context.enemyCards.V },
    context: normalFixture.context
  })
  assert.equal(normalCutIn.kind, "normal-defeat")
  assert.equal(normalCutIn.text, "通常撃破 1")

  const advantageFixture = createFixture({
    userOverrides: { type: "mon", currentAtk: 10 },
    enemyOverrides: { type: "sun", currentHp: 100 }
  })
  const advantageCutIn = selectAttackCutIn({
    attackerEntry: { team: "user", slot: "A", card: advantageFixture.context.userCards.A },
    defenderEntry: { team: "enemy", slot: "V", card: advantageFixture.context.enemyCards.V },
    context: advantageFixture.context
  })
  assert.deepEqual(
    { kind: advantageCutIn.kind, team: advantageCutIn.team, text: advantageCutIn.text, portraitUrl: advantageCutIn.portraitUrl },
    { kind: "attribute-advantage", team: "user", text: "弱点をついた！！", portraitUrl: null }
  )

  const enemyFinalFixture = createFixture({
    userOverrides: { type: "mon", currentHp: 30 },
    enemyOverrides: { type: "tue", currentAtk: 100 }
  })
  const enemyFinalCutIn = selectAttackCutIn({
    attackerEntry: { team: "enemy", slot: "V", card: enemyFinalFixture.context.enemyCards.V },
    defenderEntry: { team: "user", slot: "A", card: enemyFinalFixture.context.userCards.A },
    context: enemyFinalFixture.context
  })
  assert.deepEqual(
    { kind: enemyFinalCutIn.kind, team: enemyFinalCutIn.team, text: enemyFinalCutIn.text },
    { kind: "final-defeat", team: "enemy", text: "最終撃破 11" }
  )
})

test("攻撃不成立時はモーション・状態更新・mobile HUD非表示を実行しない", async () => {
  const fixture = createFixture()
  let motionCount = 0
  let resolveCount = 0
  const { services, calls } = createServices(fixture, {
    canAttack: () => false,
    playAttackMotion: async () => { motionCount += 1 },
    resolveAttack: () => { resolveCount += 1 }
  })

  const result = await executeSingleAttack({
    attacker: fixture.context.userCards.A,
    defender: fixture.context.enemyCards.V,
    attackerTeam: "user",
    defenderTeam: "enemy",
    attackerSlot: "A",
    defenderSlot: "V",
    context: fixture.context,
    services
  })

  assert.equal(result.attackSucceeded, false)
  assert.equal(motionCount, 0)
  assert.equal(resolveCount, 0)
  assert.deepEqual(calls.mobileHudVisibility, [])
})

test("着地後にresolveAttackを1回実行し、ヒット・振動・HP更新を同時開始して撃破する", async () => {
  const fixture = createFixture({ enemyOverrides: { currentHp: 30 } })
  let resolveCount = 0
  let releaseImpact
  const impactBarrier = new Promise((resolve) => { releaseImpact = resolve })
  const starts = []
  const base = createServices(fixture)
  const { services } = createServices(fixture, {
    ...base.services,
    resolveAttack: (...args) => {
      starts.push("resolve")
      resolveCount += 1
      return base.services.resolveAttack(...args)
    },
    playAttackMotion: async ({ onImpact }) => {
      starts.push("slam")
      await onImpact()
      starts.push("motion-complete")
    },
    playHitEffect: async () => { starts.push("hit"); await impactBarrier },
    playHitShake: async () => { starts.push("shake"); await impactBarrier },
    showDamageNumber: async () => { starts.push("damage") },
    animateNumberChange: async () => { starts.push("hp-number") },
    animateHpBar: async () => { starts.push("hp-bar") },
    playDefeatEffect: async (target) => {
      assert.equal(target, fixture.ui.enemyDefeatEffectLayerElement)
      starts.push("defeat-effect")
    },
    fadeDefeatedCard: async () => { starts.push("defeat-fade") }
  })

  const attackPromise = executeSingleAttack({
    attacker: fixture.context.userCards.A,
    defender: fixture.context.enemyCards.V,
    attackerTeam: "user",
    defenderTeam: "enemy",
    attackerSlot: "A",
    defenderSlot: "V",
    context: fixture.context,
    services
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(starts.slice(0, 7), ["slam", "resolve", "hit", "shake", "damage", "hp-number", "hp-bar"])
  assert.deepEqual(base.calls.mobileHudVisibility, [
    { team: "user", slot: "A", visible: false }
  ])
  releaseImpact()
  const result = await attackPromise

  assert.equal(resolveCount, 1)
  assert.equal(result.defeated, true)
  assert.equal(fixture.elements.get("enemy/V").dataset.canBattle, "false")
  assert.ok(starts.indexOf("defeat-effect") > starts.indexOf("motion-complete"))
  assert.ok(starts.includes("defeat-fade"))
  assert.equal(base.calls.syncs, 1)
  assert.deepEqual(base.calls.mobileHudVisibility, [
    { team: "user", slot: "A", visible: false },
    { team: "user", slot: "A", visible: true }
  ])
})

test("エネミー攻撃中はエネミーmobile HUDだけを隠し、hit完了後に戻す", async () => {
  const fixture = createFixture()
  let releaseHit
  const hitBarrier = new Promise((resolve) => { releaseHit = resolve })
  const { services, calls } = createServices(fixture, {
    playHitEffect: async () => { await hitBarrier }
  })

  const attackPromise = executeSingleAttack({
    attacker: fixture.context.enemyCards.V,
    defender: fixture.context.userCards.A,
    attackerTeam: "enemy",
    defenderTeam: "user",
    attackerSlot: "V",
    defenderSlot: "A",
    context: fixture.context,
    services
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(calls.mobileHudVisibility, [
    { team: "enemy", slot: "V", visible: false }
  ])
  releaseHit()
  await attackPromise
  assert.deepEqual(calls.mobileHudVisibility, [
    { team: "enemy", slot: "V", visible: false },
    { team: "enemy", slot: "V", visible: true }
  ])
})

test("onImpactが複数回呼ばれてもresolveAttackを2回実行しない", async () => {
  const fixture = createFixture()
  let resolveCount = 0
  const base = createServices(fixture)
  const { services } = createServices(fixture, {
    ...base.services,
    resolveAttack: (...args) => {
      resolveCount += 1
      return base.services.resolveAttack(...args)
    },
    playAttackMotion: async ({ onImpact }) => {
      await onImpact()
      await onImpact()
    }
  })

  await assert.rejects(executeSingleAttack({
    attacker: fixture.context.userCards.A,
    defender: fixture.context.enemyCards.V,
    attackerTeam: "user",
    defenderTeam: "enemy",
    attackerSlot: "A",
    defenderSlot: "V",
    context: fixture.context,
    services
  }), /onImpactが複数回/)
  assert.equal(resolveCount, 1)
})

test("firstとsecondのYAML待機値をそのまま使い、SPD表示DOMは更新しない", async () => {
  const fixture = createFixture({
    userOverrides: { currentHp: 100, currentAtk: 10 },
    enemyOverrides: { currentHp: 100, currentAtk: 10 }
  })
  const { services, calls } = createServices(fixture)
  const result = await executeCombatPair({
    first: { team: "user", slot: "A", card: fixture.context.userCards.A },
    second: { team: "enemy", slot: "V", card: fixture.context.enemyCards.V },
    context: fixture.context,
    services
  })

  assert.equal(result.completed, false)
  assert.deepEqual(calls.waits, [1200, 800])
  assert.equal(calls.numberChanges.some((change) => change.label.endsWith(":spd")), false)
})

test("先攻で後攻カードを撃破した場合はsecond待機と後攻をスキップする", async () => {
  const fixture = createFixture({ userOverrides: { currentAtk: 100 }, enemyOverrides: { currentHp: 30 } })
  fixture.context.enemyCards.W.canBattle = true
  fixture.elements.get("enemy/W").dataset.canBattle = "true"
  const { services, calls } = createServices(fixture)
  const result = await executeCombatPair({
    first: { team: "user", slot: "A", card: fixture.context.userCards.A },
    second: { team: "enemy", slot: "V", card: fixture.context.enemyCards.V },
    context: fixture.context,
    services
  })

  assert.equal(result.completed, false)
  assert.deepEqual(calls.waits, [1200])
  assert.equal(result.records.length, 1)
  assert.deepEqual(calls.sequence, [
    "wait:1200",
    "cut-in:user",
    "mobile-hud:user:A:false",
    "attack",
    "mobile-hud:user:A:true"
  ])
  assert.equal(calls.cutIns[0].text, "通常撃破 1")
})

test("通常ターンで出撃、攻防、帰還、リベンジ強化まで実行する", async () => {
  const fixture = createFixture({
    userOverrides: { currentAtk: 10 },
    enemyOverrides: { currentAtk: 10 }
  })
  let buffApplied = false
  const { services, calls } = createServices(fixture, {
    applyPendingRevengeBuffs: (cards) => {
      if (!buffApplied && cards === Object.values(fixture.context.userCards)) return 0
      if (!buffApplied && cards[0] === fixture.context.userCards.A) {
        fixture.context.userCards.A.currentAtk += 5
        buffApplied = true
        return 1
      }
      return 0
    }
  })
  // 配列同一性に依存せずユーザーチーム初回だけ強化する
  let applyCount = 0
  services.applyPendingRevengeBuffs = (cards) => {
    applyCount += 1
    if (applyCount === 1) fixture.context.userCards.A.currentAtk += 5
    return cards.length
  }

  const result = await runNormalTurn({ context: fixture.context, services })

  assert.equal(result.status, "turn-completed")
  assert.equal(calls.covers, 2)
  assert.equal(calls.retreats, 2)
  assert.equal(calls.movesToBattle, 2)
  assert.equal(calls.reveals, 2)
  assert.equal(calls.showsBattleStatus, 2)
  const firstStatusShowIndex = calls.sequence.findIndex((event) => event.startsWith("show-status:"))
  assert.ok(firstStatusShowIndex > calls.sequence.indexOf("reveal:user"))
  assert.ok(firstStatusShowIndex > calls.sequence.indexOf("reveal:enemy"))
  const userHudShowIndex = calls.sequence.indexOf("mobile-hud:user:A:true")
  const enemyHudShowIndex = calls.sequence.indexOf("mobile-hud:enemy:V:true")
  assert.ok(userHudShowIndex > calls.sequence.indexOf("reveal:user"))
  assert.ok(enemyHudShowIndex > calls.sequence.indexOf("reveal:enemy"))
  assert.deepEqual(calls.mobileHudVisibility, [
    { team: "user", slot: "A", visible: false },
    { team: "enemy", slot: "V", visible: false },
    { team: "user", slot: "A", visible: true },
    { team: "enemy", slot: "V", visible: true },
    { team: "user", slot: "A", visible: false },
    { team: "user", slot: "A", visible: true },
    { team: "enemy", slot: "V", visible: false },
    { team: "enemy", slot: "V", visible: true },
    { team: "user", slot: "A", visible: false },
    { team: "enemy", slot: "V", visible: false },
    { team: "user", slot: "A", visible: true },
    { team: "enemy", slot: "V", visible: true }
  ])
  assert.equal(calls.movesToHand, 2)
  assert.equal(calls.restores, 2)
  assert.equal(calls.revenge, 1)
  assert.deepEqual(calls.choiceStates, ["visible", "hidden"])
  assert.deepEqual(calls.choiceDimmedEnemyCards, [["V"]])
})

test("通常戦闘がユーザー勝利結果を返して全滅時に停止する", async () => {
  const fixture = createFixture({ userOverrides: { currentAtk: 100 }, enemyOverrides: { currentHp: 30 } })
  const { services, calls } = createServices(fixture)
  const result = await runNormalBattle(fixture.context, { services })

  assert.equal(result.status, "completed")
  assert.equal(result.winner, "user")
  assert.deepEqual(result.lastAttacker, { team: "user", slot: "A", cardId: 1 })
  assert.deepEqual(result.lastDefeated, { team: "enemy", slot: "V", cardId: 11 })
  assert.equal(result.finalAttackResult.defeated, true)
  assert.equal(calls.entries, 10)
  assert.deepEqual(calls.coverFades, [500])
  assert.equal(calls.coverFinishes, 1)
  assert.deepEqual(calls.waits.slice(0, 2), [100, 500])
  assert.equal(calls.battleStarts, 1)
  assert.deepEqual(calls.choiceStates, ["visible", "hidden"])
  assert.equal(calls.movesToHand, 0)
  assert.equal(calls.restores, 0)
  assert.equal(calls.revenge, 0)
})

test("全滅しないターンの後に次ターンへ進む", async () => {
  const fixture = createFixture({
    userOverrides: { currentAtk: 60 },
    enemyOverrides: { currentHp: 100, currentAtk: 0 }
  })
  let selectionCount = 0
  const { services, calls } = createServices(fixture, {
    waitForUserCardSelection: async () => {
      selectionCount += 1
      return {
        slot: "A",
        card: fixture.context.userCards.A,
        cardElement: fixture.elements.get("user/A")
      }
    }
  })
  const result = await runNormalBattle(fixture.context, { services })

  assert.equal(result.winner, "user")
  assert.equal(selectionCount, 2)
  assert.deepEqual(calls.choiceStates, ["visible", "hidden", "visible", "hidden"])
})

test("通常戦闘がCPU勝利結果を返す", async () => {
  const fixture = createFixture({ userOverrides: { currentHp: 30 }, enemyOverrides: { currentAtk: 100 } })
  const { services, calls } = createServices(fixture, { determineFirstAttacker: () => "enemy" })
  const result = await runNormalBattle(fixture.context, { services })

  assert.equal(result.status, "completed")
  assert.equal(result.winner, "enemy")
  assert.equal(result.lastAttacker.team, "enemy")
  assert.equal(result.lastDefeated.team, "user")
  assert.equal(calls.movesToHand, 0)
  assert.equal(calls.restores, 0)
  assert.equal(calls.revenge, 0)
})

test("AbortSignal中断時にcancelledを返す", async () => {
  const fixture = createFixture()
  const { services, calls } = createServices(fixture)
  const controller = new AbortController()
  controller.abort()
  const result = await runNormalBattle(fixture.context, { signal: controller.signal, services })

  assert.deepEqual(result, {
    status: "cancelled",
    winner: null,
    userCards: fixture.context.userCards,
    enemyCards: fixture.context.enemyCards
  })
  assert.equal(fixture.ui.choiceDimElement.style.visibility, "hidden")
  assert.equal(fixture.ui.choicePromptElement.style.visibility, "hidden")
  assert.equal(calls.choiceStates.at(-1), "hidden")
})

test("実行中の通常戦闘を二重開始しない", async () => {
  const fixture = createFixture()
  let releaseEntry
  const entryBarrier = new Promise((resolve) => { releaseEntry = resolve })
  const controller = new AbortController()
  const { services } = createServices(fixture, { playCardEntry: async () => { await entryBarrier } })
  const firstRun = runNormalBattle(fixture.context, { signal: controller.signal, services })
  await new Promise((resolve) => setImmediate(resolve))

  await assert.rejects(
    runNormalBattle(fixture.context, { services }),
    /既に実行中/
  )
  controller.abort()
  releaseEntry()
  assert.equal((await firstRun).status, "cancelled")
})
