require "rails_helper"

RSpec.describe "Password settings", type: :system do
  def settings_layout_metrics(width:, height:)
    page.current_window.resize_to(width, height)

    page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const headerLink = document.querySelector(".app-header__settings-link")
        const sidebarList = document.querySelector(".app-sidebar__list--bottom")
        const sidebarLink = sidebarList.querySelector(".app-sidebar__link")
        const headerIcon = headerLink.querySelector(".app-header__settings-icon svg")
        const sidebarIcon = sidebarLink.querySelector(".app-sidebar__icon svg")
        const headerNotification = document.querySelector(
          '[data-password-setup-notification="header"]'
        )
        const sidebarNotification = document.querySelector(
          '[data-password-setup-notification="sidebar"]'
        )
        const headerIconRect = headerIcon.getBoundingClientRect()
        const sidebarIconRect = sidebarIcon.getBoundingClientRect()
        const headerNotificationRect = headerNotification.getBoundingClientRect()
        const sidebarNotificationRect = sidebarNotification.getBoundingClientRect()

        return {
          headerLinkDisplay: getComputedStyle(headerLink).display,
          headerLinkWidth: headerLink.getBoundingClientRect().width,
          sidebarLinkWidth: sidebarLink.getBoundingClientRect().width,
          sidebarListDisplay: getComputedStyle(sidebarList).display,
          headerNotificationWidth: headerNotificationRect.width,
          sidebarNotificationWidth: sidebarNotificationRect.width,
          headerIconWidth: headerIconRect.width,
          sidebarIconWidth: sidebarIconRect.width,
          headerNotificationIsRight: headerNotificationRect.left > headerIconRect.right,
          sidebarNotificationIsLeft: sidebarNotificationRect.right < sidebarIconRect.left,
          pointerEvents: getComputedStyle(
            headerNotificationRect.width > 0 ? headerNotification : sidebarNotification
          ).pointerEvents,
          animationName: getComputedStyle(
            headerNotificationRect.width > 0 ? headerNotification : sidebarNotification,
            "::before"
          ).animationName,
          animationDuration: getComputedStyle(
            headerNotificationRect.width > 0 ? headerNotification : sidebarNotification,
            "::before"
          ).animationDuration,
          mainNavigationItemCount: document.querySelectorAll(
            ".app-sidebar__list:not(.app-sidebar__list--bottom) .app-sidebar__item"
          ).length,
          hasHorizontalOverflow:
            document.documentElement.scrollWidth > document.documentElement.clientWidth
        }
      })()
    JAVASCRIPT
  end

  it "確認不一致を画面内で止め、一致時だけ確認後にパスワードを変更する" do
    user = FactoryBot.create(
      :user,
      login_id: "SETTING1",
      password: "Old_1234",
      password_confirmation: "Old_1234"
    )
    FactoryBot.create(:user_card, user: user, card_id: 1)

    visit login_path
    fill_in "ログインID", with: user.login_id
    fill_in "パスワード", with: "Old_1234"
    fill_in "ニックネーム", with: "設定テスト"
    fill_in "再び継続すること", with: "設定を確認する"
    click_button "再ログインして続ける"

    visit settings_path
    fill_in "現在のパスワード", with: "Old_1234"
    fill_in "変更後のパスワード", with: "New_1234"
    fill_in "変更後のパスワード確認", with: "New_1235"
    click_button "パスワード変更"

    expect(page).to have_text("新しいパスワードとパスワード確認が一致しません。")
    expect(user.reload.authenticate("Old_1234")).to eq(user)

    fill_in "変更後のパスワード確認", with: "New_1234"
    dismiss_confirm("パスワードを変更しますか？") do
      click_button "パスワード変更"
    end

    expect(user.reload.authenticate("Old_1234")).to eq(user)

    accept_confirm("パスワードを変更しますか？") do
      click_button "パスワード変更"
    end

    expect(page).to have_current_path(settings_path)
    expect(page).to have_text("パスワードを変更しました。")
    expect(user.reload.authenticate("New_1234")).to eq(user)
    expect(user.authenticate("Old_1234")).to be(false)
  end

  it "パスワード未設定かつ達成済みの場合だけ各画面幅の設定導線へ通知を表示する" do
    user = FactoryBot.create(
      :user,
      login_id: "SETTING2",
      password: "Old_1234",
      password_confirmation: "Old_1234"
    )
    FactoryBot.create(:user_card, user: user, card_id: 1)

    visit login_path
    fill_in "ログインID", with: user.login_id
    fill_in "パスワード", with: "Old_1234"
    fill_in "ニックネーム", with: "設定通知テスト"
    fill_in "再び継続すること", with: "設定通知を確認する"
    click_button "再ログインして続ける"

    user.update!(password_digest: nil)
    FactoryBot.create(:task_completion, user: user)
    visit settings_path

    expect(page).to have_css("[data-password-setup-warning]", visible: :all)
    expect(page).to have_css("[data-password-setup-notification]", count: 2, visible: :all)

    pc = settings_layout_metrics(width: 1440, height: 900)
    expect(pc.fetch("headerLinkDisplay")).to eq("none")
    expect(pc.fetch("headerLinkWidth")).to eq(0)
    expect(pc.fetch("sidebarLinkWidth")).to be_positive
    expect(pc.fetch("headerNotificationWidth")).to eq(0)
    expect(pc.fetch("sidebarNotificationWidth").fdiv(pc.fetch("sidebarIconWidth"))).to be_within(0.01).of(0.8)
    expect(pc.fetch("sidebarNotificationIsLeft")).to be(true)
    expect(pc.fetch("hasHorizontalOverflow")).to be(false)

    tablet = settings_layout_metrics(width: 1024, height: 768)
    expect(tablet.fetch("headerLinkDisplay")).to eq("none")
    expect(tablet.fetch("headerLinkWidth")).to eq(0)
    expect(tablet.fetch("sidebarLinkWidth")).to be_positive
    expect(tablet.fetch("headerNotificationWidth")).to eq(0)
    expect(tablet.fetch("sidebarNotificationWidth").fdiv(tablet.fetch("sidebarIconWidth"))).to be_within(0.01).of(0.8)
    expect(tablet.fetch("sidebarNotificationIsLeft")).to be(true)
    expect(tablet.fetch("hasHorizontalOverflow")).to be(false)

    mobile = settings_layout_metrics(width: 390, height: 844)
    expect(mobile.fetch("headerLinkDisplay")).to eq("grid")
    expect(mobile.fetch("headerLinkWidth")).to be_positive
    expect(mobile.fetch("sidebarListDisplay")).to eq("none")
    expect(mobile.fetch("sidebarLinkWidth")).to eq(0)
    expect(mobile.fetch("sidebarNotificationWidth")).to eq(0)
    expect(mobile.fetch("headerNotificationWidth").fdiv(mobile.fetch("headerIconWidth"))).to be_within(0.01).of(0.8)
    expect(mobile.fetch("headerNotificationIsRight")).to be(true)
    expect(mobile.fetch("mainNavigationItemCount")).to eq(5)
    expect(mobile.fetch("pointerEvents")).to eq("none")
    expect(mobile.fetch("animationName")).to eq("settings-password-notification-pulse")
    expect(mobile.fetch("animationDuration")).to eq("2.4s")
    expect(mobile.fetch("hasHorizontalOverflow")).to be(false)

    link_rect_before_animation = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const rect = document.querySelector(".app-header__settings-link").getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      })()
    JAVASCRIPT
    sleep 0.5
    link_rect_after_animation = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const rect = document.querySelector(".app-header__settings-link").getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      })()
    JAVASCRIPT
    expect(link_rect_after_animation).to eq(link_rect_before_animation)

    find(".app-header__settings-link").click
    expect(page).to have_current_path(settings_path)

    console_errors = page.driver.browser.logs.get(:browser).select do |entry|
      entry.level == "SEVERE"
    end
    expect(console_errors).to be_empty
  end
end
