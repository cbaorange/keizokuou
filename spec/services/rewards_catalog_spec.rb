require "rails_helper"

RSpec.describe RewardsCatalog do
  it "一覧とポップアップの形状比率と報酬コンテンツを読み込む" do
    yaml = YAML.safe_load_file(described_class::DATA_PATH)
    data = described_class.load!

    expect(data.fetch("folder")).to eq(yaml.fetch("folder"))
    expect(data.fetch("content_popup_folder")).to eq(
      yaml.fetch("content_popup_folder")
    )
    expect(data.fetch("contents")).to eq(yaml.fetch("contents"))
  end

  it "folderに3つ目の形状設定がある場合は拒否する" do
    allow(YAML).to receive(:safe_load_file).and_return(
      "folder" => {
        "slope_start_ratio" => 0.37,
        "tab_height_ratio" => 0.09,
        "height_ratio" => 0.48,
        "slope_end_ratio" => 0.46
      },
      "content_popup_folder" => {
        "slope_start_ratio" => 0.37,
        "tab_height_ratio" => 0.09
      },
      "contents" => []
    )

    expect { described_class.load! }.to raise_error(
      described_class::ConfigurationError,
      /slope_start_ratio, tab_height_ratio, height_ratioだけ/
    )
  end

  it "斜め終点がフォルダ幅を超える設定を拒否する" do
    allow(YAML).to receive(:safe_load_file).and_return(
      "folder" => {
        "slope_start_ratio" => 0.95,
        "tab_height_ratio" => 0.09,
        "height_ratio" => 0.48
      },
      "content_popup_folder" => {
        "slope_start_ratio" => 0.37,
        "tab_height_ratio" => 0.09
      },
      "contents" => []
    )

    expect { described_class.load! }.to raise_error(
      described_class::ConfigurationError,
      /合計は1以下/
    )
  end


  it "ポップアップ形状の不正値を一覧形状と分けて報告する" do
    allow(YAML).to receive(:safe_load_file).and_return(
      "folder" => {
        "slope_start_ratio" => 0.37,
        "tab_height_ratio" => 0.09,
        "height_ratio" => 0.48
      },
      "content_popup_folder" => {
        "slope_start_ratio" => 0.95,
        "tab_height_ratio" => 0.09
      },
      "contents" => []
    )

    expect { described_class.load! }.to raise_error(
      described_class::ConfigurationError,
      /content_popup_folder.*合計は1以下/
    )
  end

  it "folderの高さ比率が0以下の場合は拒否する" do
    allow(YAML).to receive(:safe_load_file).and_return(
      "folder" => {
        "slope_start_ratio" => 0.37,
        "tab_height_ratio" => 0.09,
        "height_ratio" => 0
      },
      "content_popup_folder" => {
        "slope_start_ratio" => 0.37,
        "tab_height_ratio" => 0.09
      },
      "contents" => []
    )

    expect { described_class.load! }.to raise_error(
      described_class::ConfigurationError,
      /folder.height_ratioは0より大きい数値/
    )
  end

  it "idのないコンテンツも配列要素として受け付ける" do
    allow(YAML).to receive(:safe_load_file).and_return(
      "folder" => {
        "slope_start_ratio" => 0.3,
        "tab_height_ratio" => 0.1,
        "height_ratio" => 0.48
      },
      "content_popup_folder" => {
        "slope_start_ratio" => 0.37,
        "tab_height_ratio" => 0.09
      },
      "contents" => [
        { "title" => "1件目", "body" => "本文1", "required_rate" => 0 },
        { "title" => "2件目", "body" => "本文2", "required_rate" => 100 }
      ]
    )

    expect(described_class.load!.fetch("contents").size).to eq(2)
  end

  it "required_rateがないコンテンツを拒否する" do
    allow(YAML).to receive(:safe_load_file).and_return(
      "folder" => {
        "slope_start_ratio" => 0.3,
        "tab_height_ratio" => 0.1,
        "height_ratio" => 0.7
      },
      "content_popup_folder" => {
        "slope_start_ratio" => 0.37,
        "tab_height_ratio" => 0.09
      },
      "contents" => [{ "title" => "不足", "body" => "本文" }]
    )

    expect { described_class.load! }.to raise_error(
      described_class::ConfigurationError,
      /contents\[0\]\.required_rateがありません/
    )
  end

  it "required_rateが0以上の整数でないコンテンツを拒否する" do
    allow(YAML).to receive(:safe_load_file).and_return(
      "folder" => {
        "slope_start_ratio" => 0.3,
        "tab_height_ratio" => 0.1,
        "height_ratio" => 0.7
      },
      "content_popup_folder" => {
        "slope_start_ratio" => 0.37,
        "tab_height_ratio" => 0.09
      },
      "contents" => [{
        "title" => "不正",
        "body" => "本文",
        "required_rate" => "100"
      }]
    )

    expect { described_class.load! }.to raise_error(
      described_class::ConfigurationError,
      /required_rateは0以上の整数/
    )
  end
end
