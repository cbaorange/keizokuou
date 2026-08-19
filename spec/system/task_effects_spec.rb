require "rails_helper"

RSpec.describe "Task effects", type: :system do
  around do |example|
    previous_setting = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    example.run
  ensure
    ActionController::Base.allow_forgery_protection = previous_setting
  end

  def load_tasks_with_controlled_portrait_decode
    page.driver.browser.execute_cdp(
      "Emulation.setScriptExecutionDisabled",
      value: true
    )

    begin
      refresh
    ensure
      page.driver.browser.execute_cdp(
        "Emulation.setScriptExecutionDisabled",
        value: false
      )
    end

    tasks_script_src = find(
      'script[src*="/assets/tasks"]',
      visible: :all
    )["src"]

    page.execute_script(<<~JAVASCRIPT)
      (() => {
        const originalDecode = HTMLImageElement.prototype.decode
        const message = document.querySelector("[data-syukamon-message]")

        HTMLImageElement.prototype.decode = function() {
          if (!this.classList.contains("test-syukamon-portrait")) {
            return originalDecode.call(this)
          }

          window.__portraitDecodeRequested = true

          return new Promise((resolve, reject) => {
            window.__resolvePortraitDecode = resolve
            window.__rejectPortraitDecode = reject
          })
        }

        window.__dialogueTextChanges = [{
          text: message.textContent,
          time: performance.now()
        }]

        let lastText = message.textContent
        const observer = new MutationObserver(() => {
          if (message.textContent === lastText) {
            return
          }

          lastText = message.textContent
          window.__dialogueTextChanges.push({
            text: lastText,
            time: performance.now()
          })
        })

        observer.observe(message, {
          attributes: true,
          characterData: true,
          childList: true,
          subtree: true
        })
      })()
    JAVASCRIPT
    page.execute_script(<<~JAVASCRIPT, tasks_script_src)
      (() => {
        const script = document.createElement("script")
        script.src = arguments[0]
        document.head.append(script)
      })()
    JAVASCRIPT

    expect(page).to have_css(
      "[data-syukamon-message]:not([hidden])",
      visible: :all,
      wait: 2
    )
  end

  it "shares the acquisition animation and delays the page dialogue until close" do
    visit new_user_path(partner: "1")

    fill_in "ニックネーム", with: "演出テスト"
    fill_in "継続すること", with: "演出を確認する"
    click_button "新規登録して始める"

    expect(page).to have_css("[data-card-reward-modal]:not([hidden])")
    expect(find("[data-card-reward-close]", visible: :all)).to be_disabled
    expect(
      page.evaluate_script(
        'getComputedStyle(document.querySelector("[data-card-reward-flipper]")).transform'
      )
    ).not_to eq("none")
    expect(
      page.evaluate_script(
        'getComputedStyle(document.querySelector("[data-card-reward-reveal]")).visibility'
      )
    ).to eq("hidden")
    expect(find("[data-syukamon-message]", visible: :all).text).to eq("")

    page.execute_script(
      'document.querySelector("[data-card-reward-modal]").click()'
    )
    expect(page).to have_css("[data-card-reward-modal]:not([hidden])")
    page.send_keys(:escape)
    expect(page).to have_css("[data-card-reward-modal]:not([hidden])")
    expect(page).to have_css(
      "[data-card-reward-close]:not(:disabled)",
      wait: 8
    )

    reward_message = find("[data-card-reward-message]").text
    reward_dialogue = find(
      "[data-card-reward-modal] [data-dialogue-text-measure]",
      visible: :all
    ).text

    expect(reward_message).not_to eq("")
    expect(reward_message.length).to be < reward_dialogue.length
    expect(reward_dialogue).to include(
      "演出テスト様も、新たな一歩を踏み出しましたのね？"
    )
    expect(reward_dialogue).not_to include("【nick】")

    find("[data-card-reward-close]").click
    expect(page).to have_css("[data-card-reward-modal][hidden]", visible: :all)
    message_after_close = find(
      "[data-card-reward-message]",
      visible: :all
    ).text
    sleep 0.2
    expect(find("[data-card-reward-message]", visible: :all).text).to eq(
      message_after_close
    )
    expect(page).to have_css(
      "[data-syukamon-message]",
      text: "新天地での挑戦に、不安はつきものですわ。"
    )
    accept_confirm do
      find(".task-item[data-task-id]", visible: true).click
    end

    expect(page).to have_css("[data-card-reward-modal]:not([hidden])")
    expect(find("[data-card-reward-close]", visible: :all)).to be_disabled
    dialogue_while_modal_open = find("[data-syukamon-message]").text
    page.execute_script(
      'document.querySelector("[data-card-reward-modal]").click()'
    )
    expect(page).to have_css("[data-card-reward-modal]:not([hidden])")
    expect(page).to have_css(
      "[data-card-reward-close]:not(:disabled)",
      wait: 15
    )
    expect(find("[data-syukamon-message]").text).to eq(
      dialogue_while_modal_open
    )

    reward_message = find("[data-card-reward-message]").text
    reward_dialogue = find(
      "[data-card-reward-modal] [data-dialogue-text-measure]",
      visible: :all
    ).text

    expect(reward_message).not_to eq("")
    expect(reward_message.length).to be < reward_dialogue.length

    page.execute_script(
      'document.querySelector("[data-card-reward-modal]").click()'
    )
    expect(page).to have_css("[data-card-reward-modal][hidden]", visible: :all)
    expect(page).to have_css(
      "[data-syukamon-message]",
      text: "不慣れなことに取り組むときは",
      wait: 8
    )
  end

  it "waits for portrait preparation and paints zero characters before typing" do
    visit new_user_path(partner: "1")

    fill_in "ニックネーム", with: "初回準備テスト"
    fill_in "継続すること", with: "初回表示を確認する"
    click_button "新規登録して始める"

    expect(page).to have_css(
      "[data-card-reward-close]:not(:disabled)",
      wait: 15
    )
    find("[data-card-reward-close]").click

    load_tasks_with_controlled_portrait_decode

    expect(page.evaluate_script("window.__portraitDecodeRequested")).to be(true)
    expect(find("[data-syukamon-message]", visible: :all).text).to eq("")
    expect(
      find(
        "[data-syukamon-panel] [data-dialogue-text-measure]",
        visible: :all
      ).text
    ).not_to eq("")

    page.execute_script("window.__resolvePortraitDecode()")
    expect(page).to have_css("[data-syukamon-message]:not(:empty)", wait: 2)

    first_run = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const fullText = document.querySelector(
          "[data-syukamon-panel] [data-dialogue-text-measure]"
        ).textContent
        const changes = window.__dialogueTextChanges

        return {
          firstCharacter: Array.from(fullText)[0],
          firstVisibleText: changes.find((change) => change.text !== "")?.text,
          hadZeroCharacterState: changes.some((change) => change.text === ""),
          resetAfterTypingStarted: changes.slice(
            changes.findIndex((change) => change.text !== "") + 1
          ).some((change) => change.text === "")
        }
      })()
    JAVASCRIPT

    expect(first_run.fetch("hadZeroCharacterState")).to be(true)
    expect(first_run.fetch("firstVisibleText")).to eq(
      first_run.fetch("firstCharacter")
    )
    expect(first_run.fetch("resetAfterTypingStarted")).to be(false)

    load_tasks_with_controlled_portrait_decode

    expect(page.evaluate_script("window.__portraitDecodeRequested")).to be(true)
    expect(find("[data-syukamon-message]", visible: :all).text).to eq("")

    page.execute_script("window.__rejectPortraitDecode(new Error('decode failed'))")
    expect(page).to have_css("[data-syukamon-message]:not(:empty)", wait: 2)

    page.execute_script("window.dispatchEvent(new PageTransitionEvent('pagehide'))")
    text_after_pagehide = find("[data-syukamon-message]").text
    sleep 0.2
    expect(find("[data-syukamon-message]").text).to eq(text_after_pagehide)
  end
end
