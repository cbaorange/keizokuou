module OffsetDate
  def self.today(params)
    if Debug.enabled? && params[:debug_date].present?
      Date.parse(params[:debug_date])
    else
      Date.today
    end
  end
end