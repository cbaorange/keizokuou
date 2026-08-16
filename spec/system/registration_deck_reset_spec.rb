require "rails_helper"

RSpec.describe "Registration deck reset", type: :system do
  before do
    # 並行実行中の別system specとテストサーバーのポートを分離する
    Capybara.server_port = 4461
    Capybara.app_host = "http://#{Capybara.server_host}:#{Capybara.server_port}"
  end

  def stored_deck
    page.evaluate_script('JSON.parse(localStorage.getItem("deck"))')
  end

  def browser_console_errors
    page.driver.browser.logs.get(:browser).select do |entry|
      entry.level == "SEVERE"
    end
  end

  it "新規登録送信時に空デッキへ戻し、初期カードを左端へ自動編成する" do
    visit new_user_path
    page.execute_script(
      'localStorage.setItem("deck", JSON.stringify([1, 2, 3, 4, 5]))'
    )

    fill_in "ニックネーム", with: "デッキ初期化テスト"
    fill_in "継続すること", with: "デッキ初期化を確認する"
    choose "新しい挑戦を始めたい"
    click_button "新規登録して始める"

    expect(page).to have_current_path(root_path)
    expect(page).to have_css("[data-card-reward-modal]:not([hidden])")
    expect(stored_deck).to eq([1, 0, 0, 0, 0])

    page.execute_script(
      'localStorage.setItem("deck", JSON.stringify([1, 2, 3, 4, 5]))'
    )
    refresh

    expect(stored_deck).to eq([1, 2, 3, 4, 5])
    expect(browser_console_errors).to be_empty
  end

  it "再ログインでは既存デッキを初期化しない" do
    user = FactoryBot.create(
      :user,
      login_id: "DECKTEST",
      password: "Password_1",
      password_confirmation: "Password_1"
    )
    FactoryBot.create(:user_card, user: user, card_id: 1)

    visit login_path
    page.execute_script(
      'localStorage.setItem("deck", JSON.stringify([1, 2, 3, 4, 5]))'
    )

    fill_in "ログインID", with: user.login_id
    fill_in "パスワード", with: "Password_1"
    fill_in "ニックネーム", with: "再ログインテスト"
    fill_in "再び継続すること", with: "デッキ維持を確認する"
    click_button "再ログインして続ける"

    expect(page).to have_current_path(root_path)
    expect(stored_deck).to eq([1, 2, 3, 4, 5])
    expect(browser_console_errors).to be_empty
  end
end
