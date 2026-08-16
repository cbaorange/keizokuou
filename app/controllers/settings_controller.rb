# frozen_string_literal: true

# ログイン中のユーザーに、ログインID確認とパスワード設定機能を提供する
class SettingsController < ApplicationController
  PASSWORD_MINIMUM_LENGTH = 4
  PASSWORD_MAXIMUM_LENGTH = ActiveModel::SecurePassword::MAX_PASSWORD_LENGTH_ALLOWED
  PASSWORD_FORMAT = /\A[A-Za-z0-9_]+\z/

  def show
    @password_errors = []
  end

  def update_password
    password_was_registered = current_user.password_digest.present?
    @password_errors = password_validation_errors

    return render_invalid_password if @password_errors.any?

    return render_password_save_failure unless save_password

    redirect_to settings_path, notice: password_success_message(password_was_registered)
  end

  private

  def password_validation_errors
    [
      current_password_error,
      *new_password_errors,
      password_confirmation_error
    ].compact
  end

  def current_password_error
    return if current_user.password_digest.blank?
    return if current_user.authenticate(password_params[:current_password].to_s)

    '現在のパスワードが正しくありません。'
  end

  def new_password_errors
    password = password_params[:password].to_s
    return ['新しいパスワードを入力してください。'] if password.blank?

    errors = []
    errors << "新しいパスワードは#{PASSWORD_MINIMUM_LENGTH}文字以上で入力してください。" if password.length < PASSWORD_MINIMUM_LENGTH
    errors << password_maximum_length_error if password.length > PASSWORD_MAXIMUM_LENGTH
    errors << '新しいパスワードに使用できる文字は半角英字、半角数字、_のみです。' unless PASSWORD_FORMAT.match?(password)
    errors
  end

  def password_maximum_length_error
    "新しいパスワードはbcryptの技術上限である#{PASSWORD_MAXIMUM_LENGTH}文字以内で入力してください。"
  end

  def password_confirmation_error
    return if password_params[:password].to_s == password_params[:password_confirmation].to_s

    '新しいパスワードとパスワード確認が一致しません。'
  end

  def save_password
    current_user.update(
      password: password_params[:password].to_s,
      password_confirmation: password_params[:password_confirmation].to_s
    )
  end

  def render_invalid_password
    render :show, status: :unprocessable_entity
  end

  def render_password_save_failure
    @password_errors = ['パスワードを保存できませんでした。時間をおいて再度お試しください。']
    render_invalid_password
  end

  def password_success_message(password_was_registered)
    password_was_registered ? 'パスワードを変更しました。' : 'パスワードを登録しました。'
  end

  def password_params
    @password_params ||= params.fetch(:password_settings, {}).permit(
      :current_password,
      :password,
      :password_confirmation
    )
  end
end
